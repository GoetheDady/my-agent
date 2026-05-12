import type { ChannelAdapter, ChannelMessageOutput } from "./types";

/**
 * 飞书渠道占位适配器。
 *
 * MVP 只注册渠道能力，不接真实飞书 SDK。后续接入时只需要替换 deliver 和入口路由。
 */
export class FeishuChannelAdapter implements ChannelAdapter {
  readonly channel = "feishu";

  async deliver(_output: ChannelMessageOutput): Promise<void> {
    throw new Error("Feishu channel delivery is not implemented");
  }
}
