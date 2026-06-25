export interface RewardTask {
  id: string;
  name: string;
  amount: number; // in INR
}

export const REWARD_TASKS: RewardTask[] = [
  { id: "task_1", name: "Task #1", amount: 1 },
  { id: "task_2", name: "Task #2", amount: 2 },
  { id: "task_3", name: "Task #3", amount: 3 },
  { id: "task_4", name: "Task #4", amount: 5 },
];
