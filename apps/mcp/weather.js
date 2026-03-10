import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "weather-tool", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

/**
 * 獲取天氣的簡單函數
 */
async function fetchWeather(city) {
  try {
    // 使用 wttr.in 獲取純文字天氣預報，設定格式為簡化版
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`);
    if (!res.ok) throw new Error("服務暫時不可用");
    return await res.text();
  } catch (e) {
    return `無法獲取 ${city} 的天氣資訊：${e.message}`;
  }
}

// 1. 註冊工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_weather",
      description: "獲取特定城市或地區的即時天氣情況",
      inputSchema: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "城市名稱，例如：台北、北京、Tokyo",
          },
        },
        required: ["city"],
      },
    },
  ],
}));

// 2. 處理工具調用請求
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_weather") {
    const { city } = request.params.arguments;
    console.error(`[Weather Tool] 正在查詢: ${city}`); // 使用 stderr 進行日誌紀錄，不干擾 stdout 通訊
    
    const weatherData = await fetchWeather(city);
    
    return {
      content: [
        {
          type: "text",
          text: `【天氣回報】\n${weatherData}`,
        },
      ],
    };
  }
  throw new Error("工具未定義");
});

// 3. 啟動 Stdio 傳輸層
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ 天氣 MCP Server 已啟動 (stdio)");
}

main().catch((error) => {
  console.error("❌ MCP Server 發生錯誤:", error);
  process.exit(1);
});
