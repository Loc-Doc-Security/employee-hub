import { io } from "socket.io-client";
import { getAuthToken } from "./authToken";

let socket: ReturnType<typeof io> | null = null;

export function getSocket() {
  if (!socket) {
    socket = io({ auth: { token: getAuthToken() ?? "" } });
  }
  return socket;
}
