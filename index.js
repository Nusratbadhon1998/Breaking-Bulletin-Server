require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;
const app = express();

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

    // Verify admin

    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "admin")
        return res.status(401).send({ message: "unauthorized access!!" });

      next();
    };
    // admin routes
    app.put("/users", async (req, res) => {
      const user = req.body;

      const query = { email: user?.email };

      const isUserExist = await usersCollection.findOne(query);

      if (isUserExist) {
        return res.send({ message: "User already exist" });
      }

      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      try {
        const result = await usersCollection.updateOne(
          query,
          updateDoc,
          options
        );

        res.send(result);
      } catch (err) {
        res.status(500).send("Internal Issue");
      }
    });

    app.get("/user/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });


    // Publisher Api
    app.get("/publishers", verifyToken, async (req, res) => {
      const result = await publishersCollection.find().toArray();
      res.send(result);
    });
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

    app.get("/articles", verifyToken, async (req, res) => {
      const publisher = req.query.publisher;
      const tag = req.query.tag;
      const sort = req.query.sort;
      const search = req.query.search;

      let query = {
        title: { $regex: search, $options: "i" },
      };
      if (publisher) query.publisher = publisher;
      if (tag) query.tag = tag;
      let options = {};
      if (sort) options = { sort: { postedDate: sort === "asc" ? 1 : -1 } };

      const result = await articlesCollection.find(query, options).toArray();
      res.send(result);
    });
    app.get("/all-articles", verifyToken,verifyAdmin, async (req, res) => {
     const result= await articlesCollection.find().toArray()

     
      res.send(result);
    });
    app.post("/articles", verifyToken, async (req, res) => {
      const data = req.body;

      const articleData = {
        ...data,
        postedDate: Date(),
        status: "Pending",
        premium: "no",
      };

      const result = await articlesCollection.insertOne(articleData);

      res.send(result);
    });
    app.get("/articles-count", async (req, res) => {
      const publisher = req.query.publisher;
      const tag = req.query.tag;
      const search = req.query.search;
      let query = {
        title: { $regex: search, $options: "i" },
      };
      if (publisher) query.publisher = publisher;
      if (tag) query.tag = tag;
      const count = await articlesCollection.countDocuments(query);

      res.send({ count });
    });
    app.get("/articles/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      console.log(email)
      if (req.user.email !== email)
        return res.status(403).send({ message: "Unauthorized access" });
      const query = { authorEmail:email };
      try {
        const result = await articlesCollection.find(query).toArray();
        res.send(result);
      } catch {
        res.status(500).send("Internal Issue");
      }
    });
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
      const query = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
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

    // For admin to update
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
      console.log(newStatus, isPremium);

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
