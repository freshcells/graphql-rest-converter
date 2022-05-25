# openapi-graphql-bridge

## Purpose

The package allows to create an OpenAPI-compatible HTTP API based on annotated GraphQL operations.

## Usage example

```javascript
import express from 'express'
import { buildClientSchema, getIntrospectionQuery } from 'graphql'
import { gql } from 'graphql-tag'
import {
  createOpenAPIGraphQLBridge,
  removeCustomProperties,
  createExpressMiddlewareFromOpenAPISchema,
  createHttpExecutor,
} from 'openapi-graphql-bridge'

const GRAPHQL_ENDPOINT = 'https://example.org/graphql'

const BRIDGE_DOCUMENT = gql`
  query getHeroByEpisode($episode: String!, $include_appears_in: Boolean! = false)
  @OAQuery(
    path: "/hero/{episode}"
    tags: ["Star Wars", "Hero"]
    summary: "Retrieve heros"
    description: "Retrieve heros by episode, optionally including the episodes they appear in"
    externalDocs: { url: "https://www.google.com/search?q=star+wars", description: "More information" }
    deprecated: false
  ) {
    hero(episode: $episode) {
      name
      appearsIn @include(if: $include_appears_in)
    }
  }
`

const LOCAL_PORT = '3000'
const API_PATH = '/star-wars'

const BASE_OPENAPI_SCHEMA = {
  openapi: '3.0.3',
  info: {
    title: 'Star Wars API',
    description: '...',
    version: '1.0.0',
  },
  servers: [
    {
      url: API_PATH,
      description: 'Local server',
    },
  ],
}

const getCustomScalars = (scalarTypeName: string) => {
  return {
    DateTime: {
      type: 'string',
      format: 'date-time',
    },
    JSON: {},
  }[scalarTypeName]
}

async function main() {
  const app = express()

  const graphqlSchema = buildClientSchema(
    (await (await fetch(
      GRAPHQL_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: getIntrospectionQuery() })
      }
    ).json())).data
  )

  const openAPIGraphQLBridge = createOpenAPIGraphQLBridge({
    graphqlSchema,
    graphqlDocument: BRIDGE_DOCUMENT,
    customScalars: getCustomScalars,
  })

  const openAPISchema = openAPIGraphQLBridge.getOpenAPISchema({
    baseSchema: BASE_OPENAPI_SCHEMA,
    validate: true, // Default is false
  })

  const httpExecutor = createHttpExecutor(GRAPHQL_ENDPOINT)

  const apiMiddleware = openAPIGraphQLBridge.getExpressMiddleware(
    httpExecutor,
    {
      validateRequest: true, // Default is true
      validateResponse: true, // Default is false
    }
  )

  // Alternatively the middleware can be created from the OpenAPI schema, using the `x-graphql-operation` custom properties that are included when generating the schema
  // const apiMiddleware = createExpressMiddlewareFromOpenAPISchema(
  //   openAPISchema,
  //   httpExecutor,
  //   {
  //     validateRequest: true, // Default is true
  //     validateResponse: true, // Default is false
  //   }
  // )

  app.use(API_PATH, apiMiddleware)

  app.get('/openapi.json', (req, res) => {
    // `removeCustomProperties` can be omitted if the underlying GraphQL operations should be visible as custom properties
    res.json(removeCustomProperties(openAPISchema))
  })

  app.listen(LOCAL_PORT)
}

main()
```
