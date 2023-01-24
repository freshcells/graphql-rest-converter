import schema from './schema/schema.graphql'
import { buildASTSchema } from 'graphql'
import { createOpenAPIGraphQLBridge } from '../bridge'
import { gql } from 'graphql-tag'

const api = gql`
  # This will define our OpenAPI Schema

  mutation createSample($sample: SampleInput! @OABody)
  @OAOperation(path: "/sample", method: POST, tags: ["Sample"], summary: "Creates a new sample") {
    createSample(input: $sample) {
      id
      name
    }
  }

  fragment MySamples on Sample {
    myId: id
    myName: name
  }

  query getSamples @OAOperation(path: "/samples", description: "Get all samples") {
    getSamples {
      ...MySamples
    }
  }

  query getSample($id: String! @OAParam(in: PATH))
  @OAOperation(path: "/sample/{id}", description: "Get all samples") {
    getSample(id: $id) {
      ...MySamples
    }
  }
`

const graphqlSchema = buildASTSchema(schema)

describe('OpenAPI Generation', () => {
  it('should throw for unsupported operations', () => {
    expect(() => {
      createOpenAPIGraphQLBridge({
        graphqlDocument: gql`
          subscription mySubscription($id: ID!) @OAOperation(path: "/someOp") {
            sampleAdded(id: $id) {
              id
            }
          }
        `,
        graphqlSchema,
      })
    }).toThrow(/Subscriptions \(at: mySubscription\) are unsupported at this moment/)
  })

  it('should create schema from graphql api', () => {
    const bridge = createOpenAPIGraphQLBridge({
      graphqlDocument: api,
      graphqlSchema,
    })

    const openAPISchema = bridge.getOpenAPISchema({
      baseSchema: {
        openapi: '3.0.3',
        info: {
          title: 'Sample API',
          version: '1.0.0',
          description: 'My API',
        },
      },
    })
    // paste to https://editor.swagger.io/
    console.log(JSON.stringify(openAPISchema))
  })
})
