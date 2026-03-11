import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'weather-tool', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

/**
 * 帶有重試機制的 fetch 封裝
 */
async function fetchWithRetry(url, options = {}, retries = 3, backoff = 1000) {
  const timeout = options.timeout || 10000;
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (err) {
      const isLastRetry = i === retries - 1;
      console.error(`[Weather Tool] 請求失敗 (第 ${i + 1} 次嘗試): ${err.message}`);
      if (isLastRetry) throw err;
      await new Promise((resolve) => setTimeout(resolve, backoff * (i + 1)));
    }
  }
}

/**
 * 獲取天氣與預報的函數 (使用 open-meteo.com)
 */
async function fetchWeather(city, daysInput = 1) {
  const days = Math.max(1, Math.min(14, Number.parseInt(daysInput) || 1));
  try {
    console.error(`[Weather Tool] 開始查詢: ${city}, 天數: ${days}`);

    // 1. 使用 Geocoding API
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`;
    console.error(`[Weather Tool] 請求 Geocoding: ${geoUrl}`);

    const geoRes = await fetchWithRetry(geoUrl);
    if (!geoRes.ok) {
      const errorText = await geoRes.text();
      console.error(`[Weather Tool] Geocoding 失敗: ${geoRes.status}, ${errorText}`);
      throw new Error(`Geocoding API 請求失敗: ${geoRes.status}`);
    }
    const geoData = await geoRes.json();

    if (!geoData.results || geoData.results.length === 0) {
      console.error(`[Weather Tool] 找不到城市結果: ${city}`);
      return `找不到城市：${city}`;
    }

    const { latitude, longitude, name, admin1, country } = geoData.results[0];
    const locationName = `${name}${admin1 ? `, ${admin1}` : ''}${country ? ` (${country})` : ''}`;
    console.error(`[Weather Tool] 解析到位置: ${locationName} (${latitude}, ${longitude})`);

    // 2. 使用 Forecast API
    const params = [
      `latitude=${latitude}`,
      `longitude=${longitude}`,
      'current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
      'daily=weather_code,temperature_2m_max,temperature_2m_min',
      `forecast_days=${days}`,
      'timezone=auto',
    ].join('&');

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?${params}`;
    console.error(`[Weather Tool] 請求 Forecast: ${weatherUrl}`);

    const weatherRes = await fetchWithRetry(weatherUrl);
    if (!weatherRes.ok) {
      const errorText = await weatherRes.text();
      console.error(`[Weather Tool] Forecast 失敗: ${weatherRes.status}, ${errorText}`);
      throw new Error(`Forecast API 請求失敗: ${weatherRes.status}`);
    }
    const weatherData = await weatherRes.json();
    console.error('[Weather Tool] 天氣數據獲取成功');
    if (!weatherData.current || !weatherData.daily) {
      throw new Error('API 回傳數據格式不正確');
    }

    // 當前天氣
    const {
      temperature_2m: temp,
      relative_humidity_2m: humidity,
      apparent_temperature: feelsLike,
      wind_speed_10m: wind,
      weather_code: code,
    } = weatherData.current;

    let report = `【${locationName} 即時天氣】\n`;
    report += `狀態：${getWeatherDescription(code)}\n`;
    report += `溫度：${temp}°C (體感 ${feelsLike}°C)\n`;
    report += `濕度：${humidity}%\n`;
    report += `風速：${wind} km/h\n`;

    // 每日預報
    if (days > 1) {
      report += `\n【未來 ${days} 天預報】`;
      for (let i = 0; i < weatherData.daily.time.length; i++) {
        const date = weatherData.daily.time[i];
        const maxTemp = weatherData.daily.temperature_2m_max[i];
        const minTemp = weatherData.daily.temperature_2m_min[i];
        const dayCode = weatherData.daily.weather_code[i];
        const dayDesc = getWeatherDescription(dayCode);
        report += `\n📅 ${date}：${dayDesc}，${minTemp}°C ~ ${maxTemp}°C`;
      }
    } else {
      const maxTemp = weatherData.daily.temperature_2m_max[0];
      const minTemp = weatherData.daily.temperature_2m_min[0];
      report += `今日氣溫範圍：${minTemp}°C ~ ${maxTemp}°C`;
    }

    return report;
  } catch (e) {
    console.error(`[Weather Tool] 執行出錯: ${e.message}`, e);
    return `無法獲取 ${city} 的天氣資訊：${e.message}`;
  }
}

/**
 * WMO 天氣代碼轉換
 */
function getWeatherDescription(code) {
  const codes = {
    0: '晴朗',
    1: '晴朗為主',
    2: '部分多雲',
    3: '陰天',
    45: '霧',
    48: '霧松',
    51: '毛毛雨：輕微',
    53: '毛毛雨：中度',
    55: '毛毛雨：密度高',
    56: '凍毛毛雨：輕微',
    57: '凍毛毛雨：密度高',
    61: '雨：輕微',
    63: '雨：中度',
    65: '雨：大雨',
    66: '凍雨：輕微',
    67: '凍雨：密度高',
    71: '雪：輕微',
    73: '雪：中度',
    75: '雪：大雪',
    77: '雪粒',
    80: '陣雨：輕微',
    81: '陣雨：中度',
    82: '陣雨：大雨',
    85: '陣雪：輕微',
    86: '陣雪：大雪',
    95: '雷陣雨：輕微或中度',
    96: '雷陣雨伴有輕微冰雹',
    99: '雷陣雨伴有大冰雹',
  };
  return codes[code] || '未知';
}

// 1. 註冊工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_weather',
      description: '獲取特定城市或地區的即時天氣情況及未來預報',
      inputSchema: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '城市名稱，例如：台北、北京、Tokyo',
          },
          days: {
            type: 'integer',
            description: '預報天數 (1-7 天)',
            minimum: 1,
            maximum: 7,
            default: 1,
          },
        },
        required: ['city'],
      },
    },
  ],
}));

// 2. 處理工具調用請求
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'get_weather') {
    const { city, days = 1 } = request.params.arguments;
    console.error(`[Weather Tool] 正在查詢: ${city} (預報天數: ${days})`);

    const weatherData = await fetchWeather(city, days);

    return {
      content: [
        {
          type: 'text',
          text: weatherData,
        },
      ],
    };
  }
  throw new Error('工具未定義');
});

// 3. 啟動 Stdio 傳輸層
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('✅ 天氣 MCP Server 已啟動 (stdio)');
}

main().catch((error) => {
  console.error('❌ MCP Server 發生錯誤:', error);
  process.exit(1);
});
