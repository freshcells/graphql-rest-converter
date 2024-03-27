import { FileUpload } from './processRequest.js'

/**
 * A file expected to be uploaded as it was declared in the `map` field of a
 * [GraphQL multipart request](https://github.com/jaydenseric/graphql-multipart-request-spec).
 * The {@link processRequest} function places references to an instance of
 * this class wherever the file is expected in the GraphQL operation. The scalar
 * {@link GraphQLUpload} derives it’s value from {@link Upload.promise}.
 */
export default class Upload {
  promise: Promise<FileUpload>
  resolve?: (file: FileUpload) => void
  reject?: (error: Error) => void
  value?: FileUpload

  constructor() {
    /**
     * Promise that resolves file upload details. This should only be utilized
     * by {@linkcode GraphQLUpload}.
     */
    this.promise = new Promise((resolve, reject) => {
      /**
       * Resolves the upload promise with the file upload details. This should
       * only be utilized by {@linkcode processRequest}.
       */
      this.resolve = (file: FileUpload) => {
        /**
         * The file upload details, available when the
         * {@linkcode Upload.promise} resolves. This should only be utilized by
         * {@linkcode processRequest}.
         */
        this.value = file

        resolve(file)
      }

      /**
       * Rejects the upload promise with an error. This should only be
       * utilized by {@linkcode processRequest}.
       * @param {Error} error Error instance.
       */
      this.reject = reject
    })

    // Prevent errors crashing Node.js, see:
    // https://github.com/nodejs/node/issues/20392
    this.promise.catch(() => {})
  }
}
