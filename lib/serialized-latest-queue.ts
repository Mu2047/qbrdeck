// A serialized "run in enqueue order, only the latest counts" task queue.
//
// Two independent guarantees, needed together by any caller that both (a)
// must never let two async requests for the same resource run concurrently
// — an older one finishing after a newer one could overwrite it — and (b)
// only wants the *latest* enqueued task's outcome to drive user-visible
// state — an older task settling after a newer one was queued must not
// briefly flash a stale success/error:
//
//  - enqueue() chains every task onto a single promise tail, so task N+1
//    never starts until task N has fully settled (resolved or rejected).
//    Requests can therefore never overlap or complete out of order.
//  - each enqueue() call is stamped with a monotonically increasing version
//    number. isLatest(version) tells the caller, after their task settles,
//    whether a newer task was queued in the meantime — the only signal a
//    caller needs to decide "may I use this outcome to update visible
//    state, or has newer work already superseded me?".
//
// A task's own success/failure is opaque to the queue: whatever a task
// resolves or rejects with is delivered untouched via the returned
// `settled` promise, and a rejecting task never breaks the chain for tasks
// queued after it.

export type QueuedTask<T> = () => Promise<T>

export interface Enqueued<T> {
  version: number
  settled: Promise<T>
}

export class SerializedLatestQueue<T> {
  private tail: Promise<void> = Promise.resolve()
  private latestVersion = 0

  enqueue(task: QueuedTask<T>): Enqueued<T> {
    const version = ++this.latestVersion
    let resolveSettled!: (value: T) => void
    let rejectSettled!: (reason: unknown) => void
    const settled = new Promise<T>((resolve, reject) => {
      resolveSettled = resolve
      rejectSettled = reject
    })

    this.tail = this.tail.then(async () => {
      try {
        resolveSettled(await task())
      } catch (err) {
        rejectSettled(err)
      }
    })

    return { version, settled }
  }

  isLatest(version: number): boolean {
    return version === this.latestVersion
  }
}
