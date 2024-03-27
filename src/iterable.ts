export class AsyncQueue<T> {
  private items: (T | null | Error)[] = []
  private processedItems: T[] = []
  private next: false | ((item: T | null | Error) => void) = false

  add(item: T | null | Error) {
    if (this.next) {
      this.next(item)
      this.next = false
      return
    }
    this.items.push(item)
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const result = await new Promise((resolve, reject) => {
        if (this.items.length > 0) {
          const nextItem = this.items.shift()
          if (nextItem instanceof Error) {
            return reject(nextItem)
          }
          if (nextItem) {
            this.processedItems.push(nextItem)
          }
          return resolve(nextItem)
        }
        this.next = resolve
      })
      if (result === null) {
        return
      }
      yield result
    }
  }

  cleanup(cb: (item: T) => void) {
    this.processedItems.forEach(cb)
  }
}
