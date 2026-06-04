import type { ComputedRef, Ref } from 'vue'

export interface HistoryOptions<T> {
  /** 获取当前可序列化快照 */
  capture: () => T
  /** 将快照恢复到状态 */
  restore: (snapshot: T) => void
  /** 最大栈深度，默认 50 */
  maxSize?: number
  /** 自定义相等判断，默认 JSON.stringify 比较 */
  isEqual?: (a: T, b: T) => boolean
}

export interface Transaction {
  /** 提交事务：若状态有变则入 undo 栈 */
  commit(): void
  /** 取消事务：回滚到事务开始时的状态 */
  cancel(): void
}

export interface HistoryStack<_T = unknown> {
  readonly canUndo: ComputedRef<boolean>
  readonly canRedo: ComputedRef<boolean>
  /** 正在恢复快照中（模块可据此跳过 watcher 副作用） */
  readonly isRestoring: Ref<boolean>

  /** 记录当前状态后执行修改（用于确定会产生变更的单步操作） */
  record(): void
  /** 同步批量操作：自动 capture before → 执行 fn → 比较 → 入栈 */
  batch(fn: () => void): void
  /** 异步/连续操作（拖拽、绘制）：返回 Transaction 对象 */
  transaction(): Transaction

  undo(): void
  redo(): void
  /** 清空历史（加载新文件/关闭 tab 时） */
  clear(): void
}
