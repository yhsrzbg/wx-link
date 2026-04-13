# wx-link

`wx-link` 是一个基于 TypeScript 的 iLink stateless core SDK，聚焦扫码登录、消息轮询、文本/媒体发送，以及入站媒体解析、下载和解密。

它只负责协议调用，不负责保存业务状态。`token`、`baseUrl`、`cursor`、会话和聊天记录都需要由你的应用自己保存。

通过微信的ClawBot,实现了微信自定义机器人的功能

## 文档

[在线文档](https://yhsrzbg.github.io/wx-link-doc/)

## Quick Start

先安装依赖并构建：

```bash
npm install
npm run build
```

```ts
import { loginWithQR, WxLinkClient } from "wx-link";

const login = await loginWithQR({
  onQRCode: (url) => console.log("Scan QR:", url),
});

const client = new WxLinkClient({
  baseUrl: login.baseUrl,
  token: login.botToken,
});

let cursor = "";

while (true) {
  const updates = await client.poll(cursor);
  cursor = updates.nextCursor;

  for (const msg of updates.msgs ?? []) {
    if (!msg.from_user_id) {
      continue;
    }

    await client.sendText({
      toUserId: msg.from_user_id,
      text: "hello",
      contextToken: msg.context_token,
    });
  }
}
```

## 重要限制

1. 这套能力依赖 iLink 私有 HTTP / CDN 协议，不是微信官方公开 SDK。
2. `toUserId` 需要业务方自己掌握。
3. `contextToken` 在“回复已有会话”时最稳妥；没有它时是否允许首次主动发消息，要以实际环境验证为准。
4. 收到的图片或文件通常是 CDN 密文，浏览器不能直接显示，通常需要先走 SDK 下载并解密。
5. token、cursor、会话和聊天记录需要由业务方自己管理，生产环境建议放到数据库、KMS 或密钥托管方案里。
