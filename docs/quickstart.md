# Quick Start

The shortest path to making a real API call.

## 1. Register an API application

Create an application at the [Questrade API Console](https://www.questrade.com/api/documentation/getting-started) and note your **Client ID** and optional **Client Secret**.

## 2. Clone and install

```bash
git clone https://github.com/Luxcium/questrade-api-wrapper.git
cd questrade-api-wrapper
npm install
```

## 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```dotenv
QUESTRADE_CLIENT_ID=your_client_id
QUESTRADE_REDIRECT_URI=http://localhost:3000/callback
```

## 4. Obtain an authorization code

```typescript
import { QuestradeClient } from 'questrade-api-wrapper';

const client = new QuestradeClient({
  clientId: process.env.QUESTRADE_CLIENT_ID!,
  redirectUri: process.env.QUESTRADE_REDIRECT_URI!,
});

// Print the URL the user must visit
console.log(client.getAuthorizationUrl());
```

Visit the URL, authorize the app, and copy the `code` query parameter from the redirect URL.

## 5. Exchange the code and make calls

```typescript
await client.initialize('YOUR_AUTH_CODE_HERE');

const accounts = await client.getAccounts();
console.log(accounts);

const quote = await client.getQuote(8049); // AAPL
console.log(`Bid: ${quote.bid}  Ask: ${quote.ask}`);
```

## 6. Run the example script

The repository includes a complete OAuth flow example:

```bash
npm run dev:client
```

Follow the on-screen instructions to authorize and inspect responses.
