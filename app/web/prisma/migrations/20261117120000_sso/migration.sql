-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ssoOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "loginMethod" TEXT NOT NULL DEFAULT 'pwd';

-- CreateTable
CREATE TABLE "user_identities" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_flows" (
    "id" SERIAL NOT NULL,
    "mode" VARCHAR(8) NOT NULL,
    "userId" INTEGER,
    "intentHash" VARCHAR(64),
    "stateHash" VARCHAR(64),
    "nonce" VARCHAR(64),
    "serverVerifier" VARCHAR(64),
    "clientChallenge" VARCHAR(64),
    "returnTo" VARCHAR(2048),
    "resultHash" VARCHAR(64),
    "resultSubject" VARCHAR(255),
    "resultEmail" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_flows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_subject_key" ON "user_identities"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_userId_provider_key" ON "user_identities"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_flows_intentHash_key" ON "oauth_flows"("intentHash");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_flows_stateHash_key" ON "oauth_flows"("stateHash");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_flows_resultHash_key" ON "oauth_flows"("resultHash");

-- CreateIndex
CREATE INDEX "oauth_flows_expiresAt_idx" ON "oauth_flows"("expiresAt");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_flows" ADD CONSTRAINT "oauth_flows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

