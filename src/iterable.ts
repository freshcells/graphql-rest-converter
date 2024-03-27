export class AsyncQueue<T> {
  private queue: (T | null | Error)[] = []
  processedItems: T[] = []
  #resolve: false | ((item: T | null | Error) => void) = false
  #reject: false | ((msg?: Error) => void) = false

  /**
   * alias for `add(null)`
   */
  terminate() {
    this.add(null)
  }

  /**
   * alias for `add(error)`
   */
  reject(error: Error) {
    this.add(error)
  }

  add(item: T | null | Error) {
    if (this.#resolve && !(item instanceof Error)) {
      this.#resolve(item)
      if (item !== null) {
        this.processedItems.push(item)
      }
      this.#resolve = false
      return
    }
    if (this.#reject && item instanceof Error) {
      this.#reject(item)
      this.#reject = false
      return
    }
    this.queue.push(item)
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const result = await new Promise((resolve, reject) => {
        if (this.queue.length > 0) {
          const nextItem = this.queue.shift()
          if (nextItem instanceof Error) {
            return reject(nextItem)
          }
          if (nextItem) {
            this.processedItems.push(nextItem)
          }
          return resolve(nextItem)
        }
        this.#resolve = resolve
        this.#reject = reject
      })
      if (result === null) {
        return
      }
      yield result as T
    }
  }
}
