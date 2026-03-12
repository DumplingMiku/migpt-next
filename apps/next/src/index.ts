import { ChatBot, type IMessage } from '@mi-gpt/chat';
import type { IReply } from '@mi-gpt/engine/base';
import { type EngineConfig, MiGPTEngine } from '@mi-gpt/engine/index';
import { OpenAI } from '@mi-gpt/openai';
import { deepMerge, sleep } from '@mi-gpt/utils';
import type { DeepPartial, Prettify } from '@mi-gpt/utils/typing';
import { MCPManager } from './mcp.js';
import { MiMessage } from './message.js';
import { MiService, type MiServiceConfig } from './service.js';
import { MiSpeaker } from './speaker.js';

export interface MCPServerConfig {
  name: string;
  type: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
}

export type MiGPTConfig = Prettify<
  EngineConfig<MiJiaEngine> &
    DeepPartial<{
      debug: boolean;
      mcp?: {
        enable: boolean;
        servers: MCPServerConfig[];
      };
      speaker: MiServiceConfig & {
        /**
         * 消息轮询间隔（毫秒）
         *
         * 默认 1000（最低 1 秒）
         */
        heartbeat?: number;
      };
    }>
>;

const kDefaultMiGPTConfig: MiGPTConfig = {
  debug: false,
  speaker: {
    heartbeat: 1000,
  },
};

class MiJiaEngine extends MiGPTEngine {
  config: MiGPTConfig = kDefaultMiGPTConfig;

  speaker = MiSpeaker;
  mcp?: MCPManager;

  get MiNA() {
    return MiService.MiNA!;
  }

  get MiOT() {
    return MiService.MiOT!;
  }

  async start(config: MiGPTConfig) {
    await super.start(deepMerge(kDefaultMiGPTConfig, config));

    if (this.config.mcp?.enable && this.config.mcp.servers?.length) {
      this.mcp = new MCPManager(this.config.mcp.servers as any);
      await this.mcp.init();
    }

    await MiService.init(this.config as any);

    console.log('✅ 服务已启动...');

    // 轮询间隔最小 1 秒
    const heartbeat = Math.max(1000, this.config.speaker!.heartbeat!);

    // 轮询消息
    while (this.status === 'running') {
      const msg = await MiMessage.fetchNextMessage();
      if (msg) {
        this.onMessage(msg);
      }
      await sleep(heartbeat);
    }
  }

  async askAI(msg: IMessage): Promise<IReply> {
    const tools = this.mcp?.getOpenAITools();
    const messages = (ChatBot as any)._getMessages(msg);

    let retry = 5;
    while (retry--) {
      const { text, toolCalls } = await OpenAI.chat({
        requestId: msg.id,
        createParams: {
          messages,
          tools: tools?.length ? tools : undefined,
          stream: false,
        },
      });

      if (!toolCalls?.length) {
        if (text) {
          ChatBot.addMessage({
            id: `${msg.id}_reply`,
            text,
            sender: 'assistant',
            timestamp: Date.now(),
          });
        }
        return { text };
      }

      // 处理 Tool Calls
      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        console.log(`🛠️ 正在执行工具: ${call.function.name}...`);
        try {
          const args = JSON.parse(call.function.arguments);
          const result = await this.mcp!.callTool(call.function.name, args);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          });
        } catch (e: any) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: `Error: ${e.message}`,
          });
        }
      }
    }

    return { text: '抱歉，处理工具调用超时。' };
  }
}

export const MiGPT = new MiJiaEngine();
