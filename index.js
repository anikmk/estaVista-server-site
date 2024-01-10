const express = require('express')
const app = express()
require('dotenv').config()
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')
// const { default: Stripe } = require('stripe')
const port = process.env.PORT || 5000
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY)

// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))
app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token
  console.log(token)
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

const client = new MongoClient(process.env.DB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {
    const usersCollection = client.db('estaVista').collection('users')
    const roomsCollection = client.db('estaVista').collection('rooms')
    const paymentCollection = client.db('estaVista').collection('payment')
    // auth related api
    app.post('/jwt', async (req, res) => {
      const user = req.body
      console.log('I need a new jwt', user)
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })

    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
        console.log('Logout successful')
      } catch (err) {
        res.status(500).send(err)
      }
    })

    // Save or modify user email, status in DB
    app.put('/users/:email', async (req, res) => {
      const email = req.params.email
      const user = req.body
      const query = { email: email }
      const options = { upsert: true }
      const isExist = await usersCollection.findOne(query)
      console.log('User found?----->', isExist)
      if (isExist) return res.send(isExist)
      const result = await usersCollection.updateOne(
        query,
        {
          $set: { ...user, timestamp: Date.now() },
        },
        options
      )
      res.send(result)
    })
    // get role api
    app.get('/user/:email',async (req,res)=>{
      const email = req.params.email;
      const result = await usersCollection.findOne({email});
      res.send(result)
    })

    // get all users
    app.get('/users',async(req,res)=>{
      const result = await usersCollection.find().toArray()
      res.send(result)
    })
    // update user role status:
    app.put('/users/update/:email',verifyToken,async(req,res)=>{
      const email = req.params.email;
      const user = req.body;
      const query = {email:email}
      const options = { upsert: true }
      const updateDoc = ({
        $set:{
          ...user,
          timestamp:new Date()
        }
      })
      const result = await usersCollection.updateOne(query,updateDoc,options)
      res.send(result)
    })

    // guest request for host to admin
    app.patch('/request/for/host/:email',verifyToken,async(req,res)=>{
      const email = req.params.email;
      const user = req.body;
      console.log(user)
      const query = {email:email}
      const options = {upsert:true}
      const updateDoc = ({
        $set:{
          status:user.status
        }
      })
      const result = await usersCollection.updateOne(query,updateDoc,options)
      res.send(result)
    })

    // get all rooms api
    app.get('/rooms', async(req,res)=>{
      const result = await roomsCollection.find().toArray();
      res.send(result)
    })
    // get single room api
    app.get('/room/:id',async(req,res)=>{
      const id = req.params.id;
      const result = await roomsCollection.findOne({_id: new ObjectId(id)})
      res.send(result);
    })
    // get single room for host 
    app.get('/hostRoom/:email',async(req,res)=>{
      const email = req.params.email;
      const query = {'host.email':email};
      const result = await roomsCollection.find(query).toArray();
      res.send(result);
    })

    // add room in database
    app.post('/rooms',verifyToken, async(req,res)=>{
      const roomData = req.body;
      const result = await roomsCollection.insertOne(roomData);
      res.send(result)
    })

    // create payment Intent
    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      try {
        const { price } = req.body;
        const amount = parseInt(price * 100);
        console.log('Amount:', amount);
    
        if (!price || amount < 1) {
          throw new Error('Invalid price');
        }
    
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: 'usd',
          payment_method_types: ['card']
        });
    
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("Error creating payment intent:", error);
        res.status(500).send({ error: error.message });
      }
    });
    // save payment info
    app.post('/saveBooking',async(req,res)=>{
      const paymentData = req.body;
      const result = await paymentCollection.insertOne(paymentData)
      res.send(result)
    })
    // update room status api
    app.patch('/rooms/:id',async(req,res)=>{
      const id = req.params.id;
      const status = req.body.status
      const query = {_id: new ObjectId(id)}
      const options = {upsert:true}
      const updateDoc = {
        $set:{
          booked:status
        }
      }
      const result = await roomsCollection.updateOne(query,updateDoc,options)
      res.send(result)
    })
    // get data for guest 
    app.get('/bookings',verifyToken,async(req,res)=>{
      const email = req.query.email;
      const query = {"guest.email":email}
      const result = await paymentCollection.find(query).toArray();
      res.send(result)
    })
    // get data for host
    app.get('/bookings/host',verifyToken,async(req,res)=> {
      const email = req.query.email
      const query = {host:email}
      const result = await paymentCollection.find(query).toArray()
      res.send(result)
    })

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from StayVista Server..')
})

app.listen(port, () => {
  console.log(`StayVista is running on port ${port}`)
})
