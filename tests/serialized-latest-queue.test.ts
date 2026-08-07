import { describe, it, expect, vi } from 'vitest'
import { SerializedLatestQueue } from '@/lib/serialized-latest-queue'

// Real behavioral tests against deferred promises — not source-regex checks.
// A "deferred" exposes its resolve/reject so a test can control exactly when
// a task settles, independent of wall-clock timing.
function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('SerializedLatestQueue', () => {
  it('does not begin the second task before the first settles', async () => {
    const queue = new SerializedLatestQueue<string>()
    const first = createDeferred<string>()
    let secondStarted = false

    const { settled: firstSettled } = queue.enqueue(() => first.promise)
    const { settled: secondSettled } = queue.enqueue(async () => {
      secondStarted = true
      return 'second'
    })

    // Let several microtask ticks pass with `first` still unresolved — if
    // the queue were broken, the second task would leak through here.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(secondStarted).toBe(false)

    first.resolve('first')
    await firstSettled
    await secondSettled
    expect(secondStarted).toBe(true)
  })

  it('executes tasks strictly in enqueue order', async () => {
    const queue = new SerializedLatestQueue<number>()
    const order: number[] = []

    const a = queue.enqueue(async () => { order.push(1); return 1 })
    const b = queue.enqueue(async () => { order.push(2); return 2 })
    const c = queue.enqueue(async () => { order.push(3); return 3 })

    await Promise.all([a.settled, b.settled, c.settled])
    expect(order).toEqual([1, 2, 3])
  })

  it('three tasks enqueued in a tight synchronous burst still execute in order', async () => {
    const queue = new SerializedLatestQueue<string>()
    const order: string[] = []

    const enqueued = ['x', 'y', 'z'].map(label =>
      queue.enqueue(async () => { order.push(label); return label })
    )

    await Promise.all(enqueued.map(e => e.settled))
    expect(order).toEqual(['x', 'y', 'z'])
  })

  it('a slow first task cannot finish after the second, because the second cannot start early', async () => {
    const queue = new SerializedLatestQueue<string>()
    const slowFirst = createDeferred<string>()
    const finishOrder: string[] = []

    const first = queue.enqueue(async () => {
      const value = await slowFirst.promise
      finishOrder.push('first')
      return value
    })
    const second = queue.enqueue(async () => {
      // This task has nothing to await — if the queue let it run
      // concurrently with the first, it would finish long before `first`.
      finishOrder.push('second')
      return 'second-value'
    })

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(finishOrder).toEqual([])

    slowFirst.resolve('first-value')
    await first.settled
    await second.settled
    expect(finishOrder).toEqual(['first', 'second'])
  })

  it('remains usable after a task rejects — later tasks still run', async () => {
    const queue = new SerializedLatestQueue<string>()

    const failing = queue.enqueue(async () => {
      throw new Error('boom')
    })
    const after = queue.enqueue(async () => 'still works')

    await expect(failing.settled).rejects.toThrow('boom')
    await expect(after.settled).resolves.toBe('still works')
  })

  it('a task that throws synchronously (never returns a promise) also does not break the chain', async () => {
    const queue = new SerializedLatestQueue<string>()

    const failing = queue.enqueue(() => {
      throw new Error('sync boom')
    })
    const after = queue.enqueue(async () => 'recovered')

    await expect(failing.settled).rejects.toThrow('sync boom')
    await expect(after.settled).resolves.toBe('recovered')
  })

  it('a rejecting task rejects its own settled promise with the exact thrown value, untouched', async () => {
    const queue = new SerializedLatestQueue<string>()
    const original = new Error('specific failure')

    const { settled } = queue.enqueue(async () => { throw original })

    await expect(settled).rejects.toBe(original)
  })

  it('the queue tail remains usable after several consecutive rejections, not just one', async () => {
    const queue = new SerializedLatestQueue<string>()

    const first = queue.enqueue(async () => { throw new Error('first boom') })
    const second = queue.enqueue(async () => { throw new Error('second boom') })
    const third = queue.enqueue(async () => 'survives')

    await expect(first.settled).rejects.toThrow('first boom')
    await expect(second.settled).rejects.toThrow('second boom')
    await expect(third.settled).resolves.toBe('survives')
  })

  it('produces no unhandled rejection when the caller consumes settled via a rejection handler', async () => {
    // 'unhandledRejection' fires on the shared process object, so under
    // Vitest's default parallel file execution another, unrelated test file
    // could in principle raise one at the same moment. Filter by identity
    // to a sentinel this test alone creates and throws, so a stray rejection
    // from elsewhere can never be misattributed to this queue and cause a
    // false failure (or mask a real regression) here.
    const sentinel = new Error('queue rejection sentinel')
    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => {
      if (reason === sentinel) unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      const queue = new SerializedLatestQueue<string>()
      const { settled } = queue.enqueue(async () => { throw sentinel })

      // Consume the rejection immediately, the way a well-behaved caller
      // must (mirrors saveSlides()'s try/catch around `await settled`).
      await settled.catch(() => {})

      // Give the event loop a few turns to report anything that slipped
      // through before we assert nothing did.
      await new Promise(resolve => setImmediate(resolve))
      await new Promise(resolve => setImmediate(resolve))

      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('identifies only the newest enqueued task as latest, once all have settled', async () => {
    const queue = new SerializedLatestQueue<number>()
    const a = queue.enqueue(async () => 1)
    const b = queue.enqueue(async () => 2)
    const c = queue.enqueue(async () => 3)

    await Promise.all([a.settled, b.settled, c.settled])

    expect(queue.isLatest(a.version)).toBe(false)
    expect(queue.isLatest(b.version)).toBe(false)
    expect(queue.isLatest(c.version)).toBe(true)
  })

  it('isLatest reflects enqueue order immediately, even before older tasks settle', () => {
    const queue = new SerializedLatestQueue<number>()
    const a = queue.enqueue(async () => 1)
    expect(queue.isLatest(a.version)).toBe(true)

    const b = queue.enqueue(async () => 2)
    expect(queue.isLatest(a.version)).toBe(false)
    expect(queue.isLatest(b.version)).toBe(true)
  })

  it('never executes a single enqueued task more than once', async () => {
    const queue = new SerializedLatestQueue<number>()
    const task = vi.fn(async () => 42)

    const { settled } = queue.enqueue(task)
    await settled
    // Awaiting the same settled promise again must not re-invoke the task.
    await settled

    expect(task).toHaveBeenCalledTimes(1)
  })

  it('each of several enqueued tasks runs exactly once', async () => {
    const queue = new SerializedLatestQueue<number>()
    const tasks = [vi.fn(async () => 1), vi.fn(async () => 2), vi.fn(async () => 3)]

    const enqueued = tasks.map(t => queue.enqueue(t))
    await Promise.all(enqueued.map(e => e.settled))

    for (const t of tasks) expect(t).toHaveBeenCalledTimes(1)
  })

  it('version numbers are monotonically increasing and unique per enqueue call', () => {
    const queue = new SerializedLatestQueue<number>()
    const versions = [1, 2, 3, 4].map(() => queue.enqueue(async () => 0).version)
    expect(versions).toEqual([1, 2, 3, 4])
  })
})
