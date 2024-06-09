require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xoh2yng.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production" ? true : false,
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};

// Verify token
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).send({ message: "Unauthorized access" });
  if (token) {
    jwt.verify(token, process.env.TOKEN_SECRET, (err, decoded) => {
      if (err) {
        console.log(err);
        return res.status(401).send({ message: "unauthorized access" });
      }

      req.user = decoded;
      next();
    });
  }
};

async function run() {
  try {
    const database = client.db("breakingBulletinDB");
    const articlesCollection = database.collection("articles");
    const usersCollection = database.collection("users");
    const publishersCollection = database.collection("publishers");

    // jwt generate
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.cookie("token", token, cookieOptions).send({ success: true });
    });

    // Clear token on logout
    app.get("/logout", (req, res) => {
      try {
        res
          .clearCookie("token", {
            ...cookieOptions,
            maxAge: 0,
          })
          .send({ success: true });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // Verify admin

    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "admin")
        return res.status(401).send({ message: "unauthorized access!!" });

      next();
    };
    // First time user create and update premiumTaken field
    app.put("/users", async (req, res) => {
      const user = req.body;
      console.log(user);
      const query = { email: user?.email };
      const options = { upsert: true };

      const isUserExist = await usersCollection.findOne(query);
      let premiumReset = false;
      let updateDoc = {};

      if (isUserExist) {
        updateDoc = {
          $set: {
            ...user,
            name: user.name,
            photo: user.photo,
          },
        };

        if (new Date(user.loginTime) > new Date(isUserExist.premiumTaken)) {
          updateDoc.$set.premiumTaken = null;
          premiumReset = true;
        }
      } else {
        updateDoc = {
          $set: {
            ...user,
            role: "user",
            timestamp: Date.now(),
          },
        };
      }

      try {
        const result = await usersCollection.updateOne(
          query,
          updateDoc,
          options
        );

        res.send({ result, premiumReset });
      } catch (err) {
        res.status(500).send("Internal Issue");
      }
    });

    // For admin
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const size = parseInt(req.query.size);
      const page = parseInt(req.query.page) - 1;
      const result = await usersCollection
        .find()
        .skip(page * size)
        .limit(size)
        .toArray();
      res.send(result);
    });
    // For payment page
    app.patch("/user/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (req.user.email !== email)
        return res.status(403).send({ message: "Forbidden access" });
      const { premiumTakenDate } = req.body;
      console.log(premiumTakenDate);

      const query = { email };
      const updateDoc = {
        $set: {
          premiumTaken: premiumTakenDate,
        },
      };
      try {
        const result = await usersCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (err) {
        console.log(err);
      }
    });
    // make admin
    app.patch(
      "/user/admin/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const query = { email };
        const updateDoc = {
          $set: {
            role: "admin",
          },
        };
        try {
          const result = await usersCollection.updateOne(query, updateDoc);
          res.send(result);
        } catch (err) {
          console.log(err);
        }
      }
    );
    app.get("/user/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (req.user.email !== email)
        return res.status(403).send({ message: "Forbidden access" });

      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // For home page user count
    app.get("/users-count", async (req, res) => {
      const totalUsers = await usersCollection.countDocuments();
      const normalUsers = await usersCollection
        .aggregate([
          {
            $group: {
              _id: "$role",
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              role: "$_id",
              count: 1,
              _id: 0,
            },
          },
        ])
        .toArray();
      const normalUserCount = normalUsers.filter(
        (user) => user.role === "user"
      )[0].count;
      const premiumUsersCount = await usersCollection.countDocuments({
        premiumTaken: { $ne: null },
      });
      res.send({ totalUsers, normalUserCount, premiumUsersCount });
    });
    // Publisher Api
    // Home page
    app.get("/publishers", async (req, res) => {
      const result = await publishersCollection.find().toArray();
      res.send(result);
    });
    // admin
    app.post("/publishers", verifyToken, verifyAdmin, async (req, res) => {
      const publisherData = req.body;
      const query = {
        publisherName: {
          $regex: new RegExp(`^${publisherData.publisherName}$`, "i"),
        },
      };
      const alreadyExist = await publishersCollection.findOne(query);
      if (alreadyExist) return res.send({ message: "ALready Exist" });
      const result = await publishersCollection.insertOne(publisherData);
      res.send(result);
    });

    // Articles Api

    // Need to change
    app.get("/articles", verifyToken, async (req, res) => {
      const publisher = req.query.publisher;
      const tag = req.query.tag;
      const sort = req.query.sort;
      const search = req.query.search;

      let query = { status: "Approved" };

      if (search) query.title = { $regex: search, $options: "i" };
      if (publisher) query.publisher = publisher;
      if (tag) query.tag = tag;
      let options = {};
      if (sort) options = { sort: { viewCount: sort === "true" ? -1 : 1 } };

      const result = await articlesCollection.find(query, options).toArray();
      res.send(result);
    });
    app.get("/premium-articles", async (req, res) => {
      const result = await articlesCollection
        .find({ premium: "yes" })
        .toArray();
      res.send(result);
    });
    app.get("/recent-articles", async (req, res) => {
      const options = { sort: { postedDate: -1 } };
      const query = {};
      const result = await articlesCollection
        .find(query, options, {
          projection: {
            title: 1,
            postedDate: 1,
            tag: 1,
          },
        })
        .toArray();
      res.send(result);
    });
    app.get("/trending-articles", async (req, res) => {
      try {
        const articles = await articlesCollection
          .find(
            {},
            {
              projection: {
                viewCount: 1,
                title: 1,
                postedDate: 1,
                tag: 1,
                imageURL: 1,
              },
            }
          )
          .toArray();

        articles.sort((a, b) => b.viewCount - a.viewCount);

        res.send(articles);
      } catch (error) {
        console.error("Error fetching and sorting articles:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });
    app.get("/all-articles", verifyToken, verifyAdmin, async (req, res) => {
      const result = await articlesCollection.find().toArray();

      res.send(result);
    });
    app.post("/articles", verifyToken, async (req, res) => {
      const data = req.body;

      const articleData = {
        ...data,
        postedDate: Date(),
        status: "Pending",
        premium: "no",
        viewCount: 0,
      };

      const result = await articlesCollection.insertOne(articleData);

      res.send(result);
    });
    // get specific user article
    app.get("/articles/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (req.user.email !== email)
        return res.status(401).send({ message: "Unauthorized access" });
      const query = { authorEmail: email };
      try {
        const result = await articlesCollection.find(query).toArray();
        res.send(result);
      } catch {
        res.status(500).send("Internal Issue");
      }
    });
    // get specific article
    app.get("/article/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      try {
        const result = await articlesCollection.findOne(query);
        res.send(result);
      } catch {
        res.status(500).send("Internal Problem");
      }
    });
    app.put("/article/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const articleData = req?.body;
      const query = { _id: new ObjectId(id) };
      const options = { upsert: true };
      let updateDoc = {};
      if (articleData) {
        updateDoc = {
          $set: {
            ...articleData,
          },
        };
      }
      updateDoc = {
        $inc: { viewCount: 1 },
      };

      try {
        const result = await articlesCollection.updateOne(
          query,
          updateDoc,
          options
        );

        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).send("Internal Server Error");
      }
    });

    app.delete("/article/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await articlesCollection.deleteOne(query);
      res.send(result);
    });

    // For admin to update
    // app.get("/admin-stat", async (req, res) => {
    //   const articles = await articlesCollection
    //     .find(
    //       {},
    //       {
    //         projection: {
    //           publisher: 1,
    //         },
    //       }
    //     )
    //     .toArray();

    //   res.send(articles);
    // });
    app.get("/admin-stat", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const publisherCounts = await articlesCollection
          .aggregate([
            {
              $group: {
                _id: "$publisher",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        const chartData = publisherCounts.map((publisher) => {
          const data = [publisher._id, publisher.count];
          return data;
        });
        chartData.unshift(["Publisher Name", "Publication article"]);

        const totalUsers = await usersCollection.countDocuments();
        const totalArticles = await articlesCollection.countDocuments();

        res.send({
          chartData,
        });
      } catch (error) {
        console.error("Error fetching and counting publishers:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });
    app.put(
      "/articles/:articleId",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const articleId = req.params.articleId;
        const declineReason = req.body.declineReason;
        const query = { _id: new ObjectId(articleId) };
        const options = { upsert: true };
        const updateDoc = {
          $set: {
            declineReason,
          },
        };
        const result = await articlesCollection.updateOne(
          query,
          updateDoc,
          options
        );

        res.send(result);
      }
    );
    app.patch("/articles/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const newStatus = req.body.status;
      const isPremium = req.body.isPremium;

      const query = { _id: new ObjectId(id) };
      let updateDoc = {};
      if (isPremium) {
        updateDoc = {
          $set: { premium: isPremium },
        };
      } else if (newStatus) {
        updateDoc = {
          $set: { status: newStatus },
        };
      }

      const result = await articlesCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    // Payment intent

    app.get("/", (req, res) => {
      res.send("Server Running for Assignment 12");
    });
    app.listen(port, () => {
      console.log(`Server is running on port: ${port}`);
    });
  } finally {
    console.log("Connection successful");
  }
}
run().catch(console.dir);
