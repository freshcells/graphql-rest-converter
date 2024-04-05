import { OperationDefinitionNode } from 'graphql/index.js'
import { DocumentNode } from 'graphql'

export const getAllVariablesFromDocuments = (docs: DocumentNode[]) => {
  return Object.fromEntries(
    docs.flatMap((document, index) => {
      return (document.definitions as OperationDefinitionNode[]).flatMap((op) => {
        return (op.variableDefinitions || []).map((v) => {
          return [`${index}.variables.${v.variable.name.value}`, v]
        })
      })
    }),
  )
}
