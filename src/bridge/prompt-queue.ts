/**
 * 提示词队列：保证"同一会话"内的多条飞书消息串行处理，
 * 避免并发调用导致 Pi 会话状态错乱。
 *
 * 实现思路：维护一个 promise 链 tail，每次入队都把任务挂到链尾，
 * 前一个任务完成后才会执行下一个。depth 用于观察当前排队深度。
 */
export class PromptQueue {
  /** 队尾 promise：前一个任务结束时 resolve，唤醒下一个任务 */
  private tail: Promise<void> = Promise.resolve();
  /** 当前排队/执行中的任务数 */
  private depthValue = 0;

  /** 当前队列深度（含正在执行的那个） */
  get depth(): number {
    return this.depthValue;
  }

  /**
   * 入队执行一个任务。
   * 返回任务本身的返回值；多个任务之间严格串行。
   */
  async enqueue<T>(run: () => Promise<T>): Promise<T> {
    this.depthValue += 1;
    const previous = this.tail;
    let release: () => void = () => {};
    // 在链尾挂一个"信号"，前一个完成 -> release() -> 本任务启动
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await run();
    } finally {
      this.depthValue -= 1;
      release();
    }
  }
}
