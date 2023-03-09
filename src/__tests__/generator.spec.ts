import schema from './schema/schema.graphql'
import { buildASTSchema } from 'graphql'
import { createOpenAPIGraphQLBridge } from '../bridge'
import { gql } from 'graphql-tag'
import { bridgeFixtures } from './fixtures'
import { getBridgeOperations } from '../graphql'

const graphqlSchema = buildASTSchema(schema)

describe('OpenAPI Generation', () => {
  describe('Bridge schema errors', () => {
    it('should throw for unsupported operations', () => {
      expect(() => {
        getBridgeOperations(
          graphqlSchema,
          gql`
            subscription mySubscription($id: Int!) @OAOperation(path: "/someOp") {
              sampleAdded(id: $id) {
                id
              }
            }
          `
        )
      }).toThrow(/Subscriptions \(at: mySubscription\) are unsupported at this moment/)
    })

    it('should deny multiple @OABody directives', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            mutation myMutation(
              $inputFirst: SampleInput! @OABody
              $inputSecond: SampleInput! @OABody
            ) @OAOperation(path: "/myMutation") {
              createSampleOne: createSample(input: $inputFirst) {
                id
              }
              createSampleTwo: createSample(input: $inputSecond) {
                id
              }
            }
          `
        )
      ).toThrow(/Only one "OABody" variable allowed/)
    })

    it('should fail in case a `path` parameter is not specified in the path', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            query myQuery($id: Int! @OAParam(in: PATH)) @OAOperation(path: "/my-query") {
              getSample(id: $id) {
                id
              }
            }
          `
        )
      ).toThrow(/Location path invalid for parameter id because it is not part of the path/)
    })
    it('should fail in case a path parameter is used within another parameter type', () => {
      expect(() =>
        getBridgeOperations(
          graphqlSchema,
          gql`
            query myQuery($id: Int! @OAParam(in: QUERY)) @OAOperation(path: "/my-query/{id}") {
              getSample(id: $id) {
                id
              }
            }
          `
        )
      ).toThrow(/Location query invalid for parameter id because it is part of the path/)
    })
  })

  it('should create schema from graphql api', () => {
    const bridge = createOpenAPIGraphQLBridge({
      graphqlDocument: bridgeFixtures,
      graphqlSchema,
    })

    const schema = bridge.getOpenAPISchema({
      baseSchema: {
        openapi: '3.0.3',
        info: {
          title: 'Sample API',
          version: '1.0.0',
          description: 'My API',
        },
      },
    })
    expect(schema).toMatchSnapshot()
  })
})
