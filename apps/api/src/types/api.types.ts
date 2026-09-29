// Shared API response shapes — used by every controller

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

// Express Request user augmentation — populated after JWT middleware
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
