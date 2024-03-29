import { gql } from 'graphql-tag'
import { buildASTSchema } from 'graphql'
import schema from './schema/schema.graphql'
import scalarSchema from './schema/custom-scalars.schema.graphql'
import { addMocksToSchema } from '@graphql-tools/mock'
import { createOpenAPIGraphQLBridge } from '../express.js'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { OpenAPIV3 } from 'openapi-types'

export const bridgeFixtures = gql`
  # This will define our OpenAPI Schema

  mutation createSample($sample: SampleInput! @OABody(description: "A Sample Input"))
  @OAOperation(path: "/sample", method: POST, tags: ["Sample"], summary: "Creates a new sample") {
    createSample(input: $sample) {
      id
      name
      type
      sku
      price
    }
  }

  mutation createDifferentSample(
    $id: String!
    $sample: SampleInput! @OABody
    $other: String! @OABody(path: "otherThing", description: "The other thing")
  ) @OAOperation(path: "/different-sample/{id}") {
    createDifferentSample(id: $id, input: $sample, otherInput: $other) {
      name
    }
  }

  mutation createSomethingWithoutArguments @OAOperation(path: "/call-without-args") {
    mutationWithoutArgs
  }

  mutation deleteASampleWithHeader($id: String! @OAParam(in: HEADER))
  @OAOperation(path: "/different-sample-in-header", method: DELETE) {
    mutationWithoutDefaultArg(id: $id)
  }

  mutation deleteASampleWithBody($id: String @OABody)
  @OAOperation(path: "/different-sample", method: DELETE) {
    mutationWithoutDefaultArg(id: $id)
  }

  mutation updateSample($id: Int! @OAParam(in: PATH), $sample: SampleInput! @OABody)
  @OAOperation(path: "/sample/{id}", method: PUT, tags: ["Sample"], summary: "Updates a sample") {
    updateSample(id: $id, input: $sample) {
      name
    }
  }

  mutation removeSample($id: Int! @OAParam(in: QUERY))
  @OAOperation(path: "/sample", method: DELETE, tags: ["Sample"], summary: "Updates a sample") {
    deleteSample(id: $id)
  }

  fragment MySamples on Sample
  @OADescription(description: "Description for my MySamples fragment") {
    myId: id @OADescription(description: "my custom description on a field")
    myName: name
  }

  query getSamples @OAOperation(path: "/samples", description: "Get all samples") {
    samples: getSamples {
      ...MySamples
    }
  }

  query getSample($id: Int! @OAParam(in: PATH))
  @OAOperation(path: "/sample/{id}", description: "Get a specific sample") {
    getSample(id: $id) {
      ...MySamples
    }
  }

  query getSampleWithDefault($id: Int! = 10 @OAParam(in: QUERY))
  @OAOperation(path: "/sample-default", security: [{ schema: "OAuth2", scopes: ["write:admin"] }]) {
    getSample(id: $id) {
      ... on Sample {
        name
      }
    }
  }

  query securedOperation($id: Int!)
  @OAOperation(path: "/secured", security: [null, { schema: "OAuth2", scopes: ["write:admin"] }]) {
    getSample(id: $id) @OADescription(description: "fetches a sample") {
      name
    }
  }
`

export const graphqlSchema = buildASTSchema(schema)

export const customScalarSchema = buildASTSchema(scalarSchema)

export const Scalars: Record<string, OpenAPIV3.SchemaObject> = {
  Datetime: {
    type: 'string',
    format: 'date-time',
  },
  Date: {
    type: 'string',
    format: 'date',
  },
  JSON: {
    type: 'object',
  },
}

export const gqlSchema = addMocksToSchema({
  schema: makeExecutableSchema({ typeDefs: graphqlSchema }),
})

export const bridge = createOpenAPIGraphQLBridge({
  graphqlDocument: bridgeFixtures,
  graphqlSchema,
})
