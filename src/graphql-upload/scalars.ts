// credits: https://github.com/jaydenseric/graphql-upload/blob/master/GraphQLUpload.mjs

import { GraphQLError, GraphQLScalarType } from 'graphql'

import Upload from './Upload.js'
import { AsyncQueue } from '../iterable.js'

/**
 * A GraphQL `Upload` scalar that can be used in a
 * [`GraphQLSchema`](https://graphql.org/graphql-js/type/#graphqlschema). It’s
 * value in resolvers is a promise that resolves
 * {@link FileUpload file upload details} for processing and storage.
 */
export const GraphQLUpload = new GraphQLScalarType({
  name: 'Upload',
  description: 'The `Upload` scalar type represents a single file upload.',
  parseValue(value) {
    if (value instanceof Upload) {
      return value.promise
    }
    if (value instanceof AsyncQueue) {
      return value
    }
    throw new GraphQLError('Upload value invalid.')
  },
  parseLiteral(node) {
    throw new GraphQLError('Upload literal unsupported.', { nodes: node })
  },
  serialize() {
    throw new GraphQLError('Upload serialization unsupported.')
  },
})

/**
 * A GraphQL `Uploads` scalar that can be used in a
 * [`GraphQLSchema`](https://graphql.org/graphql-js/type/#graphqlschema). It’s
 * value in resolvers is a AsyncGenerator that generates
 * {@link FileUpload file upload details} for processing and storage.
 */
export const GraphQLUploads = new GraphQLScalarType({
  name: 'Uploads',
  description: 'The `Uploads` scalar type represents multiple file uploads.',
  parseValue(value) {
    if (value instanceof AsyncQueue) {
      return value
    }
    throw new GraphQLError('Uploads value invalid.')
  },
  parseLiteral(node) {
    throw new GraphQLError('Uploads literal unsupported.', { nodes: node })
  },
  serialize() {
    throw new GraphQLError('Uploads serialization unsupported.')
  },
})
