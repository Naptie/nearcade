import type { Db } from 'mongodb';

export interface OAuthClientCreator {
  id?: string;
  name?: string | null;
  displayName?: string | null;
  image?: string | null;
}

export interface OAuthClientListItem {
  clientId: string;
  name: string;
  icon: string | null;
  uri: string | null;
  redirectUris: string[];
  isPublic: boolean;
  disabled: boolean;
  skipConsent: boolean;
  createdAt: string | null;
  scopes: string[];
  createdBy: string | null;
  creator: OAuthClientCreator | null;
}

export interface OAuthClientConsentInfo {
  name: string;
  icon: string | null;
  uri: string | null;
  creator: OAuthClientCreator | null;
}

const oauthClientsCollection = 'oauth_clients';

const baseClientPipeline = [
  {
    $addFields: {
      // Legacy clients only have `userId`; newer ones also persist `createdBy`.
      creatorId: { $ifNull: ['$createdBy', '$userId'] }
    }
  },
  {
    $lookup: {
      from: 'users',
      localField: 'creatorId',
      foreignField: 'id',
      as: 'creator'
    }
  },
  {
    $unwind: {
      path: '$creator',
      preserveNullAndEmptyArrays: true
    }
  }
];

export const listOAuthClients = async (
  db: Db,
  options: { isSiteAdmin: boolean; userId: string }
): Promise<OAuthClientListItem[]> => {
  const pipeline = [
    ...baseClientPipeline,
    {
      $addFields: {
        sortCreatedAt: { $ifNull: ['$createdAt', new Date(0)] }
      }
    },
    ...(options.isSiteAdmin ? [] : [{ $match: { creatorId: options.userId } }]),
    { $sort: { sortCreatedAt: -1, name: 1 } },
    {
      $project: {
        _id: 0,
        clientId: 1,
        name: 1,
        icon: 1,
        uri: 1,
        redirectUris: 1,
        public: 1,
        disabled: 1,
        skipConsent: 1,
        createdAt: 1,
        scopes: 1,
        creatorId: 1,
        sortCreatedAt: 0,
        creator: {
          id: '$creator.id',
          name: '$creator.name',
          displayName: '$creator.displayName',
          image: '$creator.image'
        }
      }
    }
  ];

  const clients = await db.collection(oauthClientsCollection).aggregate(pipeline).toArray();

  return clients.map((client) => ({
    clientId: String(client.clientId),
    name: String(client.name ?? client.clientId),
    icon: client.icon ? String(client.icon) : null,
    uri: client.uri ? String(client.uri) : null,
    redirectUris: Array.isArray(client.redirectUris)
      ? client.redirectUris.map((uri) => String(uri))
      : [],
    isPublic: !!client.public,
    disabled: !!client.disabled,
    skipConsent: !!client.skipConsent,
    createdAt: client.createdAt ? new Date(client.createdAt).toISOString() : null,
    scopes: Array.isArray(client.scopes) ? client.scopes.map((scope) => String(scope)) : [],
    createdBy: client.creatorId ? String(client.creatorId) : null,
    creator: client.creator?.id
      ? {
          id: String(client.creator.id),
          name: client.creator.name ? String(client.creator.name) : null,
          displayName: client.creator.displayName ? String(client.creator.displayName) : null,
          image: client.creator.image ? String(client.creator.image) : null
        }
      : null
  }));
};

export const getOAuthClientConsentInfo = async (
  db: Db,
  clientId: string
): Promise<OAuthClientConsentInfo | null> => {
  const [client] = await db
    .collection(oauthClientsCollection)
    .aggregate([
      { $match: { clientId, disabled: { $ne: true } } },
      ...baseClientPipeline,
      {
        $project: {
          _id: 0,
          clientId: 1,
          name: 1,
          icon: 1,
          uri: 1,
          creator: {
            id: '$creator.id',
            name: '$creator.name',
            displayName: '$creator.displayName',
            image: '$creator.image'
          }
        }
      }
    ])
    .toArray();

  if (!client) {
    return null;
  }

  return {
    name: String(client.name ?? client.clientId),
    icon: client.icon ? String(client.icon) : null,
    uri: client.uri ? String(client.uri) : null,
    creator: client.creator?.id
      ? {
          id: String(client.creator.id),
          name: client.creator.name ? String(client.creator.name) : null,
          displayName: client.creator.displayName ? String(client.creator.displayName) : null,
          image: client.creator.image ? String(client.creator.image) : null
        }
      : null
  };
};
