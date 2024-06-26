import express, { Request, RequestHandler, Response } from 'express'
import { processRequest } from '../processRequest.js'
import request from 'supertest'
import assert from 'node:assert'
import { HttpError } from 'http-errors'

const handleAsyncError = (cb: (req: Request, res: Response) => Promise<void>) =>
  (async (req, res, next) => {
    try {
      return await cb(req, res)
    } catch (e) {
      if (e instanceof HttpError) {
        return res.status(e.statusCode).send(e.message)
      }
      return next(e)
    }
  }) as RequestHandler

describe('graphql-upload-spec', () => {
  it('`processRequest` with no files.', async () => {
    const app = express()
    app.use(async (req, res) => {
      const result = await processRequest(req, res)
      res.status(200).send(result.operations)
    })
    const operation = {
      query: `mutation upload($a: Upload) { uploadFile(file: $a) }`,
      variables: { a: true },
    }

    await request(app)
      .post('/')
      .field('operations', JSON.stringify(operation))
      .field('map', '{}')
      .expect(200)
  })
  it('`processRequest` with a missing multipart form field file.', async () => {
    const app = express()
    app.use(
      handleAsyncError(async (req, res) => {
        const { operations } = await processRequest(req, res)
        assert(!Array.isArray(operations))
        if ('promise' in operations.variables.file) {
          await operations.variables.file.promise
        }
        res.status(200).send(result)
      }),
    )

    const result = await request(app)
      .post('/')
      .field(
        'operations',
        JSON.stringify({
          query: `mutation upload($file: Upload!) { uploadFile(file: $a) }`,
          variables: { file: null },
        }),
      )
      .field('map', JSON.stringify({ 1: ['variables.file'] }))
      .expect(400)
    expect(result.text).toMatchSnapshot()
  })

  it('`processRequest` with missing graphql document', async () => {
    const app = express()
    app.use(
      handleAsyncError(async (req, res) => {
        const result = await processRequest(req, res)
        res.status(200).send(result.operations)
      }),
    )
    const result = await request(app)
      .post('/')
      .field(
        'operations',
        JSON.stringify({
          variables: { file: null },
        }),
      )
      .field('map', JSON.stringify({ 1: ['variables.file'] }))
      .expect(400)
    expect(result.text).toMatchSnapshot()
  })
})
