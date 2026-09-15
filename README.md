# 古法纸浆发酵记录

发酵台账 + 缸具清洗与复用放行闭环。

运行：

```bash
npm start
```

访问 `http://localhost:3039`。数据保存在 `data/paper-pulp-fermentation.json`（可用环境变量 `DB_PATH` 覆盖，`PORT` 改端口）。

测试（全流程走通：迁移、领单、清洗、复检、放行、换缸、到期拦截、并发冲突、重启恢复、422 完全回滚、页面脚本执行）：

```bash
npm test            # 接口走通（无需浏览器）
npm run test:browser  # 真实 Chromium 页面走通（需先 npx playwright install chromium）
```

## 缸具清洗与复用放行

闭环流程：**缸具建档 → 派单（班次）→ 领单 → 清洗参数登记 → 复检 → 放行（有效期）→ 到期失效**。

判定规则（页面规则说明与接口校验一致，见 `GET /api/config`）：

- 温度 60–100℃、浓度 0.5–5%、时长 20–120 分钟，操作人、消毒剂批次必填；
- 参数不齐全不可提交（工单保持已领单，可补录）；越界或消毒剂批次过期 → **整单拒绝**（422），请求完全回滚：工单、缸具状态、活动工单、占用与审计保持请求前不变，可修正后重新提交；
- 复检人不得与操作人相同；复检不通过 → 整单拒绝（缸具回待清洗，写入审计）；
- 放行默认有效期 72 小时（最长 168 小时），到期缸具与工单自动失效；剩余不足 24 小时为临期；
- 未放行、复检中、已失效、已隔离的缸具不得新建或换入批次；占用中的缸具不能派单清洗或隔离；
- 同一工单并发操作只成功一次（其余返回 409）；失败操作不改动占用与审计；
- 升级保留已有缸具与发酵数据：历史缸具标记 **待补检**，须换出批次并走完整清洗流程后方可复用，绝不自动放行。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/items` | 发酵批次列表 / 新建（须已放行且空闲缸具） |
| PATCH | `/api/items/:id` | 更新批次状态 |
| POST | `/api/items/:id/logs` `/api/items/:id/action` | 备注 / 每日观察 |
| POST | `/api/items/:id/swap-vat` | 换缸（目标须已放行且空闲，旧缸转待清洗） |
| GET/POST | `/api/vats` | 缸具列表（`status`/`q`/`usable=1` 筛选）/ 建档 |
| POST | `/api/vats/:id/quarantine` `/unquarantine` | 隔离 / 解除隔离 |
| GET/POST | `/api/disinfectants` | 消毒剂批次列表 / 登记 |
| GET/POST | `/api/cleaning-orders` | 工单列表（`vatId`/`shift`/`status`/`released`/`expiry` 筛选）/ 派单 |
| POST | `/api/cleaning-orders/:id/claim` | 领单 |
| POST | `/api/cleaning-orders/:id/cleaning` | 清洗参数登记 |
| POST | `/api/cleaning-orders/:id/recheck` | 复检 |
| POST | `/api/cleaning-orders/:id/release` | 放行（`validHours` 可选） |
| GET | `/api/audit` `/api/config` `/api/stats` | 审计日志 / 规则配置 / 统计 |

页面分三个页签：发酵批次、缸具与清洗（按缸具、班次、放行、到期筛选）、审计日志。
