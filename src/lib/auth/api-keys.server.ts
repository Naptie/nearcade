import { ObjectId } from 'mongodb';

export const getUserIdSelector = (userId: string) => {
  if (ObjectId.isValid(userId)) {
    return { _id: { $in: [new ObjectId(userId), userId] } };
  }

  return { _id: userId };
};
