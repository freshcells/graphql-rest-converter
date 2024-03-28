import { AsyncQueue } from '../iterable.js'

describe('AsyncQueue', () => {
  it('should allow to iterate over values', async () => {
    const queue = new AsyncQueue<number>()
    const p1 = new Promise<void>((resolve) =>
      setTimeout(() => {
        queue.add(1)
        resolve()
      }, 5),
    )
    const p2 = new Promise<void>((resolve) =>
      setTimeout(() => {
        queue.add(2)
        resolve()
      }, 15),
    )
    const p3 = new Promise<void>((resolve) =>
      setTimeout(() => {
        queue.add(3)
        resolve()
      }, 20),
    )
    const p4 = new Promise<void>((resolve) =>
      setTimeout(() => {
        queue.terminate()
        resolve()
      }, 30),
    )
    const allItems = []
    for await (const item of queue) {
      allItems.push(item)
    }
    await Promise.all([p1, p2, p3, p4])
    expect(queue.processedItems).toEqual(allItems)
    expect(allItems).toMatchSnapshot()
  })

  it('should throw in case of errors', async () => {
    const queue = new AsyncQueue<number>()
    const p1 = new Promise<void>((resolve) =>
      setTimeout(() => {
        queue.add(1)
        resolve()
      }, 5),
    )
    const p2 = new Promise<void>((resolve) =>
      setTimeout(() => {
        queue.reject(new Error('invalid process'))
        resolve()
      }, 15),
    )
    await expect(async () => {
      const allItems = []
      for await (const item of queue) {
        allItems.push(item)
      }
      await Promise.all([p1, p2])
    }).rejects.toThrow(new Error('invalid process'))
  })

  it('should work for async work', async () => {
    const queue = new AsyncQueue<{ fnc: () => Promise<number> }>()
    const p1 = new Promise<void>((resolve) =>
      setTimeout(() => {
        queue.add({
          fnc: async () => {
            return new Promise((resolve) => {
              setTimeout(() => {
                resolve(1)
              }, 10)
            })
          },
        })
        resolve()
      }, 5),
    )

    const p2 = new Promise<void>((resolve) =>
      setTimeout(() => {
        queue.add({
          fnc: async () => {
            return new Promise((resolve) => {
              setTimeout(() => {
                resolve(2)
              }, 10)
            })
          },
        })
        resolve()
      }, 10),
    )

    const p3 = new Promise<void>((resolve) =>
      setTimeout(() => {
        queue.terminate()
        resolve()
      }, 10),
    )

    const results = []

    for await (const item of queue) {
      results.push(await item.fnc())
    }

    await Promise.all([p1, p2, p3])
    expect(results).toMatchSnapshot()
    expect(queue.processedItems).toHaveLength(results.length)
  })
  it('should work for errors in async work', async () => {
    const queue = new AsyncQueue<{ fnc: () => Promise<number> }>()
    const p1 = new Promise<void>((resolve) =>
      setTimeout(() => {
        queue.add({
          fnc: async () => {
            return new Promise((resolve) => {
              setTimeout(() => {
                resolve(1)
              }, 10)
            })
          },
        })
        resolve()
      }, 5),
    )

    const p2 = new Promise<void>((resolve) =>
      setTimeout(() => {
        queue.add({
          fnc: async () => {
            return new Promise((resolve, reject) => {
              setTimeout(() => {
                reject(new Error('Something is broken'))
              }, 10)
            })
          },
        })
        resolve()
      }, 10),
    )

    await expect(async () => {
      const results = []
      for await (const item of queue) {
        results.push(await item.fnc())
      }
      await Promise.all([p1, p2])
    }).rejects.toThrow(new Error('Something is broken'))
  })
  it('should allow direct termination', async () => {
    const noopQueue = new AsyncQueue()
    noopQueue.terminate()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const item of noopQueue) {
      // ..
    }
    expect(true)
  })
})
