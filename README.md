# MemBot

## AI-Powered Personal Memory Assistant

MemBot is an AI-powered personal memory assistant developed by Team IntentWorks during the IIIT Pune hackathon.

It allows users to chat with an AI assistant while maintaining complete control over their personal memories. Instead of automatically saving everything, MemBot suggests useful information as memories and asks the user for approval before storing it.

## Demo

[Website Link](https://memory.byvent.com/)

[Watch the MemBot Demo Video](https://tinyurl.com/membotDemoLink)

## Key Features

- AI-powered conversational assistant
- Memory suggestions based on conversations
- User approval before saving memories
- Memory search and retrieval
- Memory categories and usage scopes
- Separate conversations and chat history
- Memory statistics and activity dashboard
- Visual memory graph
- User authentication and sessions
- Voice transcription support
- MCP integration for external tools

## How It Works

1. The user starts a conversation with MemBot.
2. The AI understands the conversation and identifies potentially useful information.
3. MemBot suggests the information as a possible memory.
4. The user reviews the suggestion.
5. The user can approve or reject the memory.
6. Approved memories are stored with their category and usage scope.
7. Relevant memories can be retrieved in future conversations.

## User-Controlled Memory

Privacy and user control are important parts of MemBot.

- Memories are not saved automatically.
- Users approve each memory before it is stored.
- Users can reject unwanted suggestions.
- Memories can be organized by category.
- Users can control how broadly each memory can be used.

## Project Structure

    IntentWorks/
    ├── apps/
    │   ├── web/              # React frontend application
    │   └── api/              # Backend API application
    ├── packages/
    │   ├── shared/           # Shared types and utilities
    │   └── ui/               # Reusable UI components
    └── docs/                 # Project documentation

## Technology Stack

### Frontend

- React
- TypeScript
- Vite
- React Router
- TanStack React Query
- Zustand
- Tailwind CSS
- shadcn/ui
- Lucide React
- Three.js

### Backend

- TypeScript
- Hono
- Cloudflare Workers
- Cloudflare D1
- Drizzle ORM
- Better Auth
- Zod
- OpenRouter
- Vectorize
- Model Context Protocol

### Database and Infrastructure

- Cloudflare D1 for database storage
- Drizzle ORM for database queries and migrations
- Cloudflare Workers for backend deployment
- Vectorize for semantic memory search
- OpenRouter for AI model integration

## Important Modules

- `apps/web/src/routes/membot.tsx` — Main MemBot chat interface
- `apps/web/src/routes/home.tsx` — User dashboard and memory statistics
- `apps/api/src/chat/loop.ts` — AI conversation and tool execution flow
- `apps/api/src/memory/` — Memory storage and retrieval logic
- `apps/api/src/routes/` — Backend API routes
- `packages/shared/` — Shared application types and constants
- `packages/ui/` — Reusable interface components

## Running the Project Locally

### Prerequisites

- Node.js or Bun
- pnpm
- Cloudflare Wrangler
- Required authentication and AI service credentials

### Installation

    git clone https://github.com/keshavkalani15/IntentWorks.git
    cd IntentWorks
    pnpm install

### Start the Frontend

    pnpm --filter web dev

### Start the Backend

    pnpm --filter api dev

The project may require environment variables for authentication, database access, AI services, and Cloudflare configuration.

## Team

Developed by Team IntentWorks for the IIIT Pune hackathon.

## Repository

[View the source code on GitHub](https://github.com/keshavkalani15/IntentWorks)
