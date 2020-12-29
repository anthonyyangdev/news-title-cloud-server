import mongodb from 'mongodb';

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

type CachedResultDoc = {
  url: string;
  time: number;
  content: NewsEntry[];
  createdAt: Date;
};

export type NewsDatabase = {
  disconnect: () => Promise<void>;
  cachedResults: mongodb.Collection<CachedResultDoc>
  newsEntries: mongodb.Collection<NewsEntry>
}

export async function initialize(mongoDbUri?: string): Promise<NewsDatabase> {
  const client = new mongodb.MongoClient(mongoDbUri || "mongodb://localhost:27017", {
    useUnifiedTopology: true,
    useNewUrlParser: true
  });
  await client.connect();
  const database = client.db('news-title-cloud');
  const cachedResults = database.collection<CachedResultDoc>('cached-results');
  const newsEntries = database.collection<NewsEntry>('news-entry');

  await cachedResults.createIndex({createdAt: 1}, {expireAfterSeconds: 60 * 30});
  await newsEntries.createIndex({url: 1}, {unique: true});
  return {
    cachedResults,
    newsEntries,
    disconnect: () => { return client.close(); }
  };
}
