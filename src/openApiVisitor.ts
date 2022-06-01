import { OpenAPIV3 } from 'openapi-types'

type VisitorContext = {
  response: OpenAPIV3.ResponseObject
  statusCode: string
  responses: OpenAPIV3.ResponsesObject
  operation: OpenAPIV3.OperationObject
  method: string
  path: string
  paths: OpenAPIV3.PathsObject
  document: OpenAPIV3.Document
}

// TODO: Support all node types
export type OpenAPIVisitor = {
  Document?: (document: OpenAPIV3.Document) => OpenAPIV3.Document
  Paths?: (
    paths: OpenAPIV3.PathsObject,
    context: Pick<VisitorContext, 'document'>
  ) => OpenAPIV3.PathsObject | undefined
  PathItem?: (
    pathItem: OpenAPIV3.PathItemObject,
    context: Pick<VisitorContext, 'document' | 'paths' | 'path'>
  ) => OpenAPIV3.PathItemObject | undefined
  Operation?: (
    operation: OpenAPIV3.OperationObject,
    context: Pick<VisitorContext, 'document' | 'paths' | 'path' | 'method'>
  ) => OpenAPIV3.OperationObject | undefined
  Responses?: (
    responses: OpenAPIV3.ResponsesObject,
    context: Pick<VisitorContext, 'document' | 'paths' | 'path' | 'method' | 'operation'>
  ) => OpenAPIV3.ResponsesObject | undefined
  Response?: (
    response: OpenAPIV3.ResponseObject,
    context: Pick<
      VisitorContext,
      'document' | 'paths' | 'path' | 'method' | 'operation' | 'responses' | 'statusCode'
    >
  ) => OpenAPIV3.ResponseObject | undefined
}

const visitorExecutorConfig = {
  Document: [['paths', 'Paths', null, 'document']],
  Paths: [[null, 'PathItem', (_k: any, v: any) => Boolean(v), 'paths', 'path']],
  PathItem: [
    [
      null,
      'Operation',
      (k: any, _v: any) => Object.values(OpenAPIV3.HttpMethods).includes(k),
      'pathItem',
      'method',
    ],
  ],
  Operation: [['responses', 'Responses', null, 'operation']],
  Responses: [
    [null, 'Response', (_k: any, v: any) => v && !('$ref' in v), 'responses', 'statusCode'],
  ],
  Response: [],
}

const makeVisitorExecutor = (visitorConfig: any) => {
  return (visitor: any, node: any, nodeType: any, context: any) => {
    const execute = (x: any, nodeType: any, context: any) => {
      let x_ = x
      const y: any = {}
      for (const nodeConfig of visitorConfig[nodeType]) {
        const [subNodeKey, subNodeType, selector, contextKey, contextKey_] = nodeConfig
        const subNode = subNodeKey ? x[subNodeKey] : x
        if (!subNode) {
          continue
        }
        if (!selector) {
          const subNode_ = execute(x[subNodeKey], subNodeType, { ...context, [contextKey]: x })
          if (subNode_) {
            y[subNodeKey] = subNode_
          }
        } else {
          for (const [key, value] of Object.entries(subNode)) {
            if (selector(key, value)) {
              const value_ = execute(value, subNodeType, {
                ...context,
                [contextKey]: x,
                [contextKey_]: key,
              })
              if (value_) {
                y[key] = value_
              }
            }
          }
        }
      }
      if (Object.keys(y).length) {
        x_ = { ...x_, ...y }
      }
      if (visitor[nodeType]) {
        x_ = visitor[nodeType](x_, context) || x_
      }
      if (x_ !== x) {
        return x_
      }
    }

    return execute(node, nodeType, context)
  }
}

const visitorExecutor = makeVisitorExecutor(visitorExecutorConfig)

export const visitOpenAPI = (visitor: OpenAPIVisitor, document: OpenAPIV3.Document) => {
  const result = visitorExecutor(visitor, document, 'Document', {})
  return result || document
}
