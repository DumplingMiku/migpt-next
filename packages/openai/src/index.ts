import { deepMerge } from '@mi-gpt/utils';
import type { Prettify } from '@mi-gpt/utils/typing';
import OpenAIClient from 'openai';
import type { RequestOptions } from 'openai/core';
import type { ChatCompletionCreateParamsBase } from 'openai/resources/chat/completions';
import { ProxyAgent } from 'proxy-agent';
import { type OpenAIConfig, kDefaultOpenAIConfig } from './config.js';

class _OpenAI {
  private _client?: OpenAIClient;
  private _abortCallbacks: Record<string, VoidFunction> = {};

  config: OpenAIConfig = {};

  init(config?: OpenAIConfig) {
    this.config = deepMerge(kDefaultOpenAIConfig, config);
    const { baseURL, apiKey, enableProxy, extra } = this.config;

    // 取得目標 User-Agent，優先使用 config.js 中的，否則使用預設值 4.98.0
    const defaultHeaders = (this.config.defaultHeaders as Record<string, string>) || {};
    const targetUA = defaultHeaders['User-Agent'] || 'OpenAI/JS 4.98.0';

    console.error(`[MiGPT] OpenAI 代理已啟動，User-Agent 鎖定為: ${targetUA}`);

    // 自定義 Fetch 攔截器
    const customFetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      
      // 強力覆寫：刪除所有 user-agent (不分大小寫)
      headers.delete('user-agent');
      headers.delete('User-Agent');
      
      // 注入我們指定的全部 Header
      for (const [key, value] of Object.entries(defaultHeaders)) {
        if (value) headers.set(key, value as string);
      }
      
      // 確保目標 User-Agent 絕對存在
      headers.set('User-Agent', targetUA);

      const plainHeaders: Record<string, string> = {};
      headers.forEach((v, k) => { plainHeaders[k] = v; });

      return fetch(url, { ...init, headers: plainHeaders });
    };

    this._client = new OpenAIClient({
      baseURL: (baseURL || kDefaultOpenAIConfig.baseURL || 'https://api.openai.com/v1') as string,
      apiKey: (apiKey || kDefaultOpenAIConfig.apiKey || '') as string,
      httpAgent: enableProxy ? (new ProxyAgent() as any) : undefined,
      ...extra?.clientOptions,
      // 多重注入：建構子層級
      defaultHeaders: {
        'User-Agent': targetUA,
        ...extra?.clientOptions?.defaultHeaders,
        ...defaultHeaders,
      },
      fetch: customFetch as any,
    });
  }

  dispose() {
    this._client = null as any;
    this._abortCallbacks = {};
  }

  cancel(requestId?: string) {
    if (requestId && this._abortCallbacks[requestId]) {
      this._abortCallbacks[requestId]();
      delete this._abortCallbacks[requestId];
    }
  }

  async chat(options: {
    requestId?: string;
    onStream?: (text: string) => void;
    onError?: (error: Error) => Promise<void>;
    requestOptions?: Prettify<RequestOptions>;
    createParams: Prettify<Partial<ChatCompletionCreateParamsBase>>;
  }) {
    const { requestId, onStream, requestOptions, createParams, onError } = options;

    let signal: AbortSignal | undefined;
    if (requestId) {
      const controller = new AbortController();
      this._abortCallbacks[requestId] = () => controller.abort();
      signal = controller.signal;
    }

    const params = deepMerge(
      {
        model: this.config.model,
        ...(this.config.extra?.createParams as any),
      },
      createParams,
    );

    // 取得目標 UA 再次在請求層級注入
    const targetUA = (this.config.defaultHeaders as any)?.['User-Agent'] || 'OpenAI/JS 4.98.0';

    const res = await this._client!.chat.completions.create(
      params,
      deepMerge(
        {
          ...(this.config.extra?.requestOptions as any),
          headers: {
            'User-Agent': targetUA,
            ...(this.config.extra?.requestOptions as any)?.headers,
            ...(this.config.defaultHeaders as any),
          }
        },
        { 
          ...requestOptions, 
          signal,
          headers: {
            'User-Agent': targetUA,
            ...requestOptions?.headers,
            ...(this.config.defaultHeaders as any),
          }
        },
      ),
    ).catch(async (e) => {
      console.error('❌ LLM 响应异常', e);
      await onError?.(e);
      return null;
    });

    let result = '';
    let toolCalls: any[] | undefined;

    if (params.stream) {
      for await (const chunk of (res ?? []) as any) {
        const choice = chunk.choices[0];
        const text = choice?.delta?.content || '';
        const calls = choice?.delta?.tool_calls;

        if (calls) {
          toolCalls ??= [];
          for (const call of calls) {
            const index = call.index ?? 0;
            if (!toolCalls[index]) {
              toolCalls[index] = { ...call, function: { ...call.function } };
            } else {
              if (call.function?.arguments) {
                toolCalls[index].function.arguments += call.function.arguments;
              }
            }
          }
        }

        const aborted = requestId && !Object.keys(this._abortCallbacks).includes(requestId);
        if (aborted) {
          result = '';
          break;
        }
        if (text) {
          result += text;
          onStream?.(text);
        }
      }
    } else {
      const message = (res as any)?.choices?.[0]?.message;
      result = message?.content ?? '';
      toolCalls = message?.tool_calls;
    }

    if (requestId) {
      delete this._abortCallbacks[requestId];
    }

    return { text: result, toolCalls };
  }
}

export const OpenAI = new _OpenAI();
