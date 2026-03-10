import { spawn } from 'node:child_process';
import { type MCPServerConfig } from './index.js';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
}

export class MCPManager {
  private servers: Map<string, any> = new Map();
  private tools: Map<string, { server: string; tool: MCPTool }> = new Map();

  constructor(private config: MCPServerConfig[]) {}

  async init() {
    for (const serverConfig of this.config) {
      try {
        if (serverConfig.type === 'stdio') {
          await this.initStdioServer(serverConfig);
        } else if (serverConfig.type === 'sse') {
          await this.initSseServer(serverConfig);
        }
      } catch (e) {
        console.error(`❌ MCP Server [${serverConfig.name}] 启动失败:`, e);
      }
    }
  }

  private async initStdioServer(config: MCPServerConfig) {
    const child = spawn(config.command!, config.args || [], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    let requestId = 1;
    const pendingRequests = new Map<number, (res: any) => void>();

    child.stdout.on('data', (data) => {
      const messages = data.toString().split('\n').filter(Boolean);
      for (const msg of messages) {
        try {
          const res = JSON.parse(msg);
          if (res.id && pendingRequests.has(res.id)) {
            pendingRequests.get(res.id)!(res);
            pendingRequests.delete(res.id);
          }
        } catch (e) {}
      }
    });

    const send = (method: string, params: any = {}) => {
      const id = requestId++;
      return new Promise((resolve) => {
        pendingRequests.set(id, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    };

    // 初始化 MCP
    await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'MiGPT', version: '1.0.0' },
    });
    await send('notifications/initialized');

    // 获取工具列表
    const res: any = await send('tools/list');
    const tools = res?.result?.tools || [];

    for (const tool of tools) {
      this.tools.set(tool.name, { server: config.name, tool });
    }

    this.servers.set(config.name, { send, type: 'stdio' });
    console.log(`✅ MCP Server [${config.name}] 已就绪，共 ${tools.length} 个工具`);
  }

  private async initSseServer(config: MCPServerConfig) {
    // SSE 实现略，由于 Node.js 原生 SSE 处理较复杂，此处优先实现 stdio
    console.warn(`⚠️ MCP Server [${config.name}] (SSE) 暂未在轻量版中实现`);
  }

  getOpenAITools() {
    return Array.from(this.tools.values()).map(({ tool }) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  async callTool(name: string, args: any) {
    const mapping = this.tools.get(name);
    if (!mapping) throw new Error(`Tool ${name} not found`);

    const server = this.servers.get(mapping.server);
    const res: any = await server.send('tools/call', { name, arguments: args });
    
    if (res.error) {
      throw new Error(res.error.message || 'Unknown error');
    }

    return res.result?.content || [];
  }
}
