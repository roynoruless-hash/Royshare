export interface User {
  id: string; // Telegram ID
  telegramId: number;
  username: string;
  firstName: string;
  lastName: string;
  photoUrl: string;
  languageCode: string;
  isPremium: boolean;
  
  // Wallet
  balance: number; // ₹
  availableBalance: number;
  totalEarnings: number;
  todayEarnings: number;
  
  // Profile
  level: "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond";
  referralCode: string;
  referredBy: string | null;
  profileCompleted: boolean;
  
  // Personal Details (Setup)
  mobileNumber?: string;
  country?: string;
  state?: string;
  city?: string;
  gender?: string;
  dateOfBirth?: string;
  language?: string;
  interests?: string[];
  education?: string;
  occupation?: string;
  incomeRange?: string;
  maritalStatus?: string;
  children?: string;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  lastActive: string;
  status: "Active" | "Banned";
}

export interface TelegramAuthResponse {
  success: boolean;
  user?: User;
  token?: string;
  error?: string;
}
