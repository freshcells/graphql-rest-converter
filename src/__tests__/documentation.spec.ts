import { getBridgeOperations } from '../graphql'
import { gql } from 'graphql-tag'
import { buildASTSchema } from 'graphql/index'
import { createOpenAPISchemaWithValidate } from '../utils'

describe('Documentation', () => {
  it('should take default descriptions of the schema', () => {
    const schema = buildASTSchema(gql`
      "Documentation of the Hero"
      type Hero {
        "Default name"
        name: String
      }
      type Query {
        "Default my Heroes"
        fetchAllMyHeroes: [Hero!]!
      }
      schema {
        query: Query
      }
    `)
    const operations = getBridgeOperations(
      schema,
      gql`
        query fetchAllMyHeroes @OAOperation(path: "/heroes") {
          fetchAllMyHeroes {
            name
          }
        }
      `
    )
    const openApiSchema = createOpenAPISchemaWithValidate(operations)

    expect(openApiSchema).toMatchSnapshot()
  })
  it('should support overwriting default descriptions', () => {
    const schema = buildASTSchema(gql`
      type Hero {
        "Default name"
        name: String
      }
      type Query {
        "Default my Heroes"
        fetchAllMyHeroes: [Hero!]!
      }
      schema {
        query: Query
      }
    `)
    const operations = getBridgeOperations(
      schema,
      gql`
        query fetchAllMyHeroes @OAOperation(path: "/heroes") {
          fetchAllMyHeroes @OADescription(description: "My Heroes") {
            name @OADescription(description: "Name of the hero")
          }
        }
      `
    )
    const openApiSchema = createOpenAPISchemaWithValidate(operations)

    expect(openApiSchema).toMatchSnapshot()
  })
})
