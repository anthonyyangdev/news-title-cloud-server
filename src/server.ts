import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import cors from 'cors';
import bodyParser from "body-parser";
import hash from 'object-hash';

dotenv.config();
const app = express();

app.use(cors({
  origin: "*",
  methods: "*"
}));
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());

export const categoryValues = [
  'Business', 'Entertainment', 'Health', 'Politics', 'Products', 'ScienceAndTechnology',
  'Sports', 'US', 'World', 'World_Africa', 'World_Americas', 'World_Asia', 'World_Europe', 'World_MiddleEast'
];

export type NewsApiParams = {
  pageSize?: number;
  category?: string;
  q?: string;
};

export type NewsEntry = {
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

const tempCache: Record<string, {
  content: NewsEntry;
  time: number;
}> = {}

app.post('/news', async (req, res) => {
  const params: NewsApiParams | undefined = req.body?.params;
  console.log(req.body, params);
  let url: string;
  if (params == null) {
    url = `https://api.bing.microsoft.com/v7.0/news/search?count=20`;
  } else {
    let {pageSize, category, q} = params;
    if (category !== undefined) {
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

  if (url in tempCache && Math.abs(Date.now() - tempCache[url].time) < 30 * 60000) {
    const timeDifference = Date.now() - tempCache[url].time;
    console.log(`Results are cached: Last updated ${timeDifference / 60000} minutes ago.`);
    return res.status(200).json({
      news: tempCache[url].content,
      lastUpdated: timeDifference
    });
  }
  console.log("Need to access the Bing News Api");
  const response = await axios.get(url, {
    headers: {'Ocp-Apim-Subscription-Key': process.env.NEWS_API_KEY_1 ?? "Unknown key"}
  });
  const json = response.data;
  if (json != null) {
    const result = json.value.map((x: Record<string, any>) => {
      return {
        title: x.name,
        source: {
          id: x.provider[0].name,
          name: x.provider[0].name
        },
        url: x.url,
        publishedAt: x.datePublished,
        urlToImage: x.image.thumbnail.contentUrl,
        author: x.provider.map((p: any) => p.name).join(" "),
        description: x.description,
        content: x.description
      };
    });
    tempCache[url] = {
      content: result,
      time: Date.now()
    };
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Server is running on port: " + PORT);
});
