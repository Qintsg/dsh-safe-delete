/**
 * 审批封装模块：将 ctx.approval 的 ask 决策封装为布尔授权。
 * fail-closed：无审批服务或无可归属 agent 时一律拒绝。
 *
 * @project dsh-safe-delete
 * @file approval.ts
 * @author Qintsg
 * @date 2026-08-13
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

/**
 * 发起一次审批请求。
 *
 * :param ctx: 插件上下文（读取可选服务 approval）
 * :param exec: 当前工具执行环境
 * :param reason: 面向用户的提问原因
 * :returns: 仅当结果明确为 allowed-once 时返回 true；
 *   无审批服务、无 agent、拒绝、取消、不可用均返回 false
 * :raises Error: 审批服务本身抛出异常（如无开启的 turn）时向上抛出
 */
export async function requestApproval(ctx: Context, exec: ToolRunContext, reason: string): Promise<boolean> {
  const approval = ctx.get('approval')
  if (approval === undefined || exec.agent === undefined) {
    // fail-closed：无审批能力或无法归属 agent 时不允许不可逆操作。
    return false
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName: exec.name,
    callId: exec.callId,
    reason,
    signal: exec.signal,
  })
  return outcome === 'allowed-once'
}
