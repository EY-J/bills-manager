// Purely informational (JS). If you switch to TypeScript later, turn this into types/interfaces.

// Bill shape:
// {
//   id: string,
//   name: string,
//   category: string,
//   dueDate: "YYYY-MM-DD" | "", // blank allowed for one-time debts with no set due date
//   cadence: "monthly" | "bi-weekly" | "weekly" | "one-time" | "statement-plan",
//   statementAmounts?: number[], // ordered monthly statement amounts for statement-plan
//   statementIndex?: number, // current statement position
//   reminderDays: 1 | 3 | 7,
//   amount: number,
//   notes: string,
//   totalMonths: number, // 0 = no installment plan
//   paidMonths: number,
//   cyclePaidAmount: number, // paid toward current billing cycle
//   payments: Array<{ id: string, date: "YYYY-MM-DD", amount: number, note?: string, settledCycles?: number }>
// }
