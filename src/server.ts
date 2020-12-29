import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import cors from 'cors';
import bodyParser from "body-parser";
import * as db from './database'
import {NewsDatabase} from "./database";

dotenv.config();

type NewsApiParams = {
  pageSize?: number;
  category?: string;
  q?: string;
};

const categoryValues = [
  'Any', 'Business', 'Entertainment', 'Health', 'Politics', 'Products', 'ScienceAndTechnology',
  'Sports', 'US', 'World', 'World_Africa', 'World_Americas', 'World_Asia', 'World_Europe', 'World_MiddleEast'
];

async function initialize() {
  const collections = await db.initialize(process.env.MONGO_DB_URI);

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

    const result = await collections.cachedResults.findOne({
      url, time: {"$gte": Date.now() - 30 * 60000}
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
      const content = values.map<db.NewsEntry>((x: Record<string, any>) => {
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
      await collections.cachedResults.insertOne({
        content, url, time: Date.now(), createdAt: new Date()
      });
      for (const entry of content) {
        if (await (collections.newsEntries.findOne({
          url: entry.url
        })) == null) {
          await collections.newsEntries.insertOne(entry);
        }
      }
      return res.status(200).json({
        news: content, lastUpdated: 0
      });
    } else {
      return res.status(400).json({
        news: [], lastUpdated: 0
      });
    }
  });

  return [app, collections] as [express.Express, NewsDatabase];
}

const PORT = process.env.PORT || 8080;
initialize().then(([app, collections]) => {
  app.listen(PORT, () => {
    console.log("Server is running on port: " + PORT);
  });
  process.on('disconnect', () => {
    collections.disconnect().then(() => {
      console.log("Disconnected from the database");
    }).catch(e => {
      console.log("Encountered error while disconnecting from database", e);
    })
  });
}).catch(console.log);
