# MiGPT-Next

> [!IMPORTANT]
> 本项目基于原作者 [idootop](https://github.com/idootop) 的 [MiGPT-Next](https://github.com/idootop/migpt-next) 进行开发与维护。

`MiGPT-Next` 是基于 [MiGPT](https://github.com/idootop/mi-gpt) 的升级版本，支持**​ 自定义消息回复 ​**、**​ 自定义请求头 ​** 以及 **​ MCP 技能扩充 ​**。

## 功能亮点

- **自定义回复**：轻松通过 `onMessage` 钩子拦截并处理用户消息。
- **自定义请求头 (User-Agent)**：在配置中直接设置 `defaultHeaders`，完美适配各种 API 服务商。
- **MCP Agent Skills**：基于 [Model Context Protocol](https://modelcontextprotocol.io/)，让 AI 具备调用外部工具的能力（如：查天气、搜网页、控制智能家居等）。

## 自定义配置

你可以在 `config.js` 中进行更深入的定制：

### 1. 自定义请求头 (User-Agent)

为了适配不同的模型服务商，你可以自定义请求头：

```js
openai: {
  // ... 其他配置
  defaultHeaders: {
    "User-Agent": "OpenAI/JS 4.98.0", // 模拟官方 SDK 请求
  },
},
```

### 2. MCP Agent Skills (技能扩充)

你可以通过 [MCP](https://modelcontextprotocol.io/) 协议让小爱音箱具备查天气、搜网页等能力：

```js
mcp: {
  enable: true,
  servers: [
    {
      name: 'weather',
      type: 'stdio',
      command: 'node',
      args: ['../mcp/weather.js'] // 运行我们提供的天气查询脚本
    }
  ]
}
```

## Docker 运行

[![Docker Image](https://img.shields.io/badge/docker-ghcr.io-blue)](https://github.com/DumplingMiku/migpt-next/pkgs/container/migpt-next)

首先，克隆仓库代码到本地。

```shell
# 克隆代码
git clone https://github.com/DumplingMiku/migpt-next.git

# 进入配置文件所在目录
cd migpt-next/apps/example
```

然后把 `config.js` 文件里的配置修改成你自己的。

> [!TIP]
> 完整的参数配置（如自定义大模型请求 headers 等） 👉 请到[此处](apps/next/README.md)查看。

```js
export default {
  speaker: {
    userId: "123456",
    password: "xxxxxxxx",
    did: "Xiaomi 智能音箱 Pro",
  },
  openai: {
    model: "gpt-4.1-mini",
    baseURL: "https://api.openai.com/v1",
    apiKey: "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  prompt: {
    system: "你是一个智能助手，请根据用户的问题给出回答。",
  },
  async onMessage(engine, { text }) {
    if (text === "测试") {
      return { text: "你好，很高兴认识你！" };
    }
  },
};
```

修改好 `config.js` 配置文件之后，Docker 一键运行。

```shell
docker run -it --rm -v $(pwd)/config.js:/app/config.js ghcr.io/dumplingmiku/migpt-next:latest
```

## Node.js 运行

[![npm version](https://badge.fury.io/js/@mi-gpt%2Fnext.svg)](https://www.npmjs.com/package/@mi-gpt/next)

首先，在你的项目里安装 `@mi-gpt/next` 依赖

```shell
pnpm install @mi-gpt/next
```

```typescript
import { MiGPT } from "@mi-gpt/next";

async function main() {
  await MiGPT.start({
    speaker: {
      userId: "123456",
      password: "xxxxxxxx",
      did: "Xiaomi 智能音箱 Pro",
    },
    openai: {
      model: "gpt-4o-mini",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    },
    prompt: {
      system: "你是一个智能助手，请根据用户的问题给出回答。",
    },
    async onMessage(engine, { text }) {
      if (text === "测试") {
        return { text: "你好，很高兴认识你！" };
      }
    },
  });
  process.exit(0);
}

main();
```

## 常见问题

### Q：一直提示登录失败，无法正常运行？

一般是因为登录小米账号时触发了安全验证，可以参考此处解决：https://github.com/idootop/migpt-next/issues/4

### Q：小爱同学总是抢话，能不能在 AI 回答的时候让小爱同学闭嘴？

> [!TIP]
> 如果你想要让小爱同学立即闭嘴，必须要刷机才能解决。相关教程请移步 👉 [Open-XiaoAI](https://github.com/idootop/open-xiaoai)

`MiGPT-Next` 的实现方式和 `MiGPT` 相同，都是走 API 请求：

- 响应延迟较大，难以打断小爱原有回复
- TTS 偶发失效，设备状态获取失败可能导致回复中断

基于上述原因，在新版 `MiGPT-Next` 中移除了对**连续对话**/流式响应功能的支持。

### Q：控制台能看到 AI 的回答文字，但是播放的还是小爱自己的回答？

`MiGPT-Next` 移除了 `ttsCommand` 参数，如果你是小爱音箱 Play（增强版）等机型，升级之后可能会出现 TTS 异常（听不到大模型的回复），你可以修改 `config.js` 文件里的 `onMessage` 函数来修复此问题：

```js
/**
 * 自定义消息回复
 */
async onMessage(engine, msg) {
  if (engine.config.callAIKeywords.some((e) => msg.text.startsWith(e))) {
    // 打断原来小爱的回复
    await engine.speaker.abortXiaoAI();
    // 调用 AI 回答
    const { text } = await engine.askAI(msg);
    console.log(`🔊 ${text}`);
    // TTS 播放文字
    await engine.MiOT.doAction(5, 1, text); // 👈 注意把 5,1 换成你的设备 ttsCommand
    return { handled: true };
  }
}
```

## 免责声明

1. **适用范围**
   本项目为开源非营利项目，仅供学术研究或个人测试用途。严禁用于商业服务、网络攻击、数据窃取、系统破坏等违反《网络安全法》及使用者所在地司法管轄区的法律规定的场景。
2. **非官方声明**
   本项目由第三方开发者独立开发，与小米集团及其关联方（下称"权利方"）无任何隶属/合作关系，亦未獲其官方授权/认可或技术支持。项目中涉及的商标、固件、云服务的所有权利归属小米集团。若权利方主张权益，使用者应立即主动停止使用并删除本项目。

继续下载或运行本项目，即表示您已完整阅读并同意[用户协议](agreement.md)，否则请立即终止使用并彻底删除本项目。

## License

MIT License © 2024-PRESENT [Del Wang](https://del.wang) © 2026-PRESENT [DumplingMiku](https://dumpling.evo-techlab.com)
