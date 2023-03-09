declare module '*.graphql' {
  import { DocumentNode } from 'graphql'
  const Query: DocumentNode

  export default Query
}
