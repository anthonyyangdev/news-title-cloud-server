import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import cors from 'cors';
import bodyParser from "body-parser";
import mongodb, {MongoClient} from 'mongodb';

dotenv.config();

type NewsApiParams = {
  pageSize?: number;
  category?: string;
  q?: string;
};

type NewsEntry = {
  title: string;
  source: {
    id: string | null,
    name: string;
  };
  url: string;
  urlToImage: string;
  publishedAt: string;
  author: string;
  description: string;
  content: string;
}

const categoryValues = [
  'Any', 'Business', 'Entertainment', 'Health', 'Politics', 'Products', 'ScienceAndTechnology',
  'Sports', 'US', 'World', 'World_Africa', 'World_Americas', 'World_Asia', 'World_Europe', 'World_MiddleEast'
];

async function initialize() {
  const client = new mongodb.MongoClient(process.env.MONGO_DB_URI || "http://localhost:27017");
  await client.connect();
  const database = client.db('news-title-cloud');
  const collection = database.collection<{
    url: string;
    time: number;
    content: NewsEntry[]
  }>('cached-results');
  await collection.createIndex({
    lastModifiedDate: 1
  }, {
    expireAfterSeconds: 60 * 30
  });
  const app = express();

  app.use(cors({
    origin: process.env.ORIGINS,
    methods: process.env.METHODS
  }));
  app.use(bodyParser.urlencoded({
    extended: true
  }));
  app.use(bodyParser.json());
  app.get('/categories', (req, res) => {
    res.status(200).json({
      categories: categoryValues.map(x => {return {value: x, text: x}})
    });
  });

  app.post('/news', async (req, res) => {
    const params: NewsApiParams | undefined = req.body?.params;
    let url: string;
    if (params == null) {
      url = `https://api.bing.microsoft.com/v7.0/news/search?count=20`;
    } else {
      let {pageSize, category, q} = params;
      if (category !== undefined && category !== 'Any') {
        if (!categoryValues.includes(category)) {
          return res.status(401).json("Invalid category: " + category);
        }
        url = `https://api.bing.microsoft.com/v7.0/news?category=${category}`;
      } else {
        const countParam = `count=${Math.max(Math.min(pageSize ?? Infinity, 100), 1)}`;
        const qParam = q !== undefined ? `q=${q}` : '';
        const headerParam = [countParam, qParam].filter(x => x.length > 0).join("&")
        url = `https://api.bing.microsoft.com/v7.0/news/search?${headerParam}`;
      }
    }

    const result = await collection.findOne({
      "url": url,
      "time": {
        "$lte": Date.now() - 30 * 60000
      }
    });
    if (result !== null) {
      const timeDifference = Date.now() - result.time;
      console.log(`Results are cached: Last updated ${timeDifference / 60000} minutes ago.`);
      return res.status(200).json({
        news: result.content,
        lastUpdated: timeDifference
      });
    }
    console.log("Need to access the Bing News Api");
    const response = await axios.get(url, {
      headers: {'Ocp-Apim-Subscription-Key': process.env.NEWS_API_KEY ?? "Unknown key"}
    });
    const json = response.data;
    if (json != null) {
      const values: Record<string, any>[] = json.value;
      const result = values.map<NewsEntry>((x: Record<string, any>) => {
        return {
          title: x.name,
          source: {
            id: x.provider[0].name,
            name: x.provider[0].name
          },
          url: x.url,
          publishedAt: x.datePublished,
          urlToImage: x.image?.thumbnail?.contentUrl,
          author: x.provider.map((p: any) => p.name).join(" "),
          description: x.description,
          content: x.description
        };
      });
      await collection.insertOne({
        content: result,
        time: Date.now(),
        url
      });
      return res.status(200).json({
        news: result,
        lastUpdated: 0
      });
    } else {
      return res.status(400).json({
        news: [],
        lastUpdated: 0
      });
    }
  });
  return [app, client] as [express.Express, MongoClient];
}

const PORT = process.env.PORT || 8080;
initialize().then(([app, client]) => {
  app.listen(PORT, () => {
    console.log("Server is running on port: " + PORT);
  });
  process.on('disconnect', () => {
    client.close();
  });
}).catch(e => {
  console.log(e);
});
