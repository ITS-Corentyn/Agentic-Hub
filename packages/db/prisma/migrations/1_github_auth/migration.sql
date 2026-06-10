-- CreateTable
CREATE TABLE "GithubAuth" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "login" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "accessToken" TEXT NOT NULL,
    "scope" TEXT,
    "tokenType" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubAuth_pkey" PRIMARY KEY ("id")
);
