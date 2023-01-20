import schema from './schema/schema.graphql'
import { buildASTSchema } from 'graphql'
import { createOpenAPIGraphQLBridge } from '../bridge'
import { gql } from 'graphql-tag'

const api = gql`
  # This will define our OpenAPI Schema

  "The description for this type"
  input DifferentInputInsideArray {
    "The description for this field"
    myName: String! @OAMap(to: "name")
    "Another description"
    myReference: [DifferentInputInsideArray!] @OAMap(to: "references")
  }

  mutation createSample(
    $name: String! @OABody
    $references: [SampleInput!]!
      @OABody(path: "some.where")
      @OAMap(from: "[DifferentInputInsideArray!]!")
  )
  @OAMutation(path: "/sample", httpVerb: POST, tags: ["Sample"], summary: "Creates a new sample") {
    createSample(input: { name: $name, references: $references }) {
      id
      name
    }
  }

  # My sample
  fragment MySamples on Sample {
    id
    name
  }

  query getSamples @OAQuery(path: "/samples", description: "Get all samples") {
    getSamples {
      ...MySamples
    }
  }
`

describe('OpenAPI Generation', () => {
  it('should create schema from graphql api', () => {
    const bridge = createOpenAPIGraphQLBridge({
      graphqlDocument: api,
      graphqlSchema: buildASTSchema(schema),
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
