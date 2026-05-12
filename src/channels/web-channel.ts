import type { ChannelAdapter, ChannelMessageOutput } from "./types";

/**
 * Web 渠道适配器。
 *
 * Web 的入站消息由 ChannelService 统一处理；当前 Web 出站仍通过 HTTP stream 返回，
 * 因此 deliver 是空实现。
 */
export class WebChannelAdapter implements ChannelAdapter {
  readonly channel = "web";

  async deliver(_output: ChannelMessageOutput): Promise<void> {
    return Promise.resolve();
  }
}
