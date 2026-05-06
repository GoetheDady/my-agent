/**
 * 应用入口
 *
 * 启动 HTTP 服务（信道系统），加载配置，注册路由。
 * MVP 阶段只有一个服务进程，后续引入多 Agent 时拆分。
 */

import { serve } from "./channels/http";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

serve(PORT);
