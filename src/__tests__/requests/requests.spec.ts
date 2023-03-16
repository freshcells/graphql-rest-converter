import { bridge, gqlSchema } from '../fixtures'
import express from 'express'
import { createSchemaExecutor } from '../../graphQLExecutor'
import request from 'supertest'

const app = express()

app.use(
  bridge.getExpressMiddleware(createSchemaExecutor(gqlSchema), {
    validateResponse: true,
    validateRequest: true,
  })
)

describe('Requests', () => {
  it('should GET `/samples`', async () => {
    const response = await request(app).get('/samples').expect(200)
    expect(response.body).toMatchSnapshot({
      samples: [
        {
          myId: expect.any(Number),
        },
        {
          myId: expect.any(Number),
        },
      ],
    })
  })
  it('should GET `/sample/id`', async () => {
    const response = await request(app).get('/sample/1').expect(200)
    expect(response.body).toMatchSnapshot({
      getSample: {
        myId: expect.any(Number),
      },
    })
  })

  it('should fail GET `/sample/id`, if id is not a number', async () => {
    const response = await request(app).get('/sample/not-a-number').expect(400)
    expect(response.body).toMatchSnapshot()
  })

  it('should POST `/sample`', async () => {
    const response = await request(app)
      .post('/sample')
      .send({ name: 'Input', moreData: [] })
      .expect(200)
    expect(response.body).toMatchSnapshot({
      createSample: {
        id: expect.any(Number),
        sku: expect.any(String),
        price: expect.any(Number),
        type: expect.any(String),
      },
    })
  })

  it('should fail on POST `/different-sample/id` with wrong request body', async () => {
    const response = await request(app)
      .post('/different-sample/10')
      .send({ name: 'Input', moreData: [] })
      .expect(400)
    expect(response.body).toMatchSnapshot()
  })

  it('should POST `/different-sample/id`', async () => {
    const response = await request(app)
      .post('/different-sample/10')
      .send({ otherThing: 'Input', sample: { name: 'Input', moreData: [] } })
      .expect(200)
    expect(response.body).toMatchSnapshot()
  })

  it('should DELETE `/different-sample`', async () => {
    const response = await request(app).delete('/different-sample').send({ id: '200' }).expect(200)
    expect(response.body).toMatchSnapshot({
      mutationWithoutDefaultArg: expect.any(Boolean),
    })
  })
  it('should DELETE `/different-sample with empty body`', async () => {
    const response = await request(app).delete('/different-sample').send({}).expect(200)
    expect(response.body).toMatchSnapshot({
      mutationWithoutDefaultArg: expect.any(Boolean),
    })
  })

  it('should DELETE `/sample`', async () => {
    const response = await request(app).delete('/sample').query({ id: 1 }).expect(200)
    expect(response.body).toMatchSnapshot({
      deleteSample: expect.any(Boolean),
    })
  })

  it('should fail on DELETE `/sample`', async () => {
    const response = await request(app).delete('/sample').query({ id: 'not-an-id' }).expect(400)
    expect(response.body).toMatchSnapshot()
  })

  it('should PUT `/sample`', async () => {
    const response = await request(app)
      .put('/sample/1')
      .send({ name: 'New Input', moreData: [] })
      .expect(200)
    expect(response.body).toMatchSnapshot()
  })

  it('should fail POST `/sample` if invalid body', async () => {
    const response = await request(app)
      .post('/sample')
      .send({ somethingUnknown: 'Input', moreData: [] })
      .expect(400)
    expect(response.body).toMatchSnapshot()
  })

  it('should not handle other verbs then defined', async () => {
    await request(app).post('/samples').expect(404)
    await request(app).delete('/samples').expect(404)
    await request(app).put('/samples').expect(404)
  })

  it('should handle default values', async () => {
    const result = await request(app).get('/sample-default').expect(200)
    expect(result.body).toMatchSnapshot()
  })
})
