// Purely informational (JS). If you switch to TypeScript later, turn this into types/interfaces.

// Bill shape:
// {
//   id: string,
//   name: string,
//   category: string,
//   dueDate: "YYYY-MM-DD",
//   cadence: "monthly" | "bi-weekly" | "weekly",
//   reminderDays: 1 | 3 | 7,
//   amount: number,
//   notes: string,
//   totalMonths: number, // 0 = no installment plan
//   paidMonths: number,
//   payments: Array<{ id: string, date: "YYYY-MM-DD", amount: number, note?: string }>
// }
