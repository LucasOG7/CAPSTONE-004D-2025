export function calcBudget_50_30_20(monthlyIncome?: number) {
  if (!monthlyIncome || monthlyIncome <= 0) return null;
  const needs = monthlyIncome * 0.50;
  const wants = monthlyIncome * 0.30;
  const savings = monthlyIncome * 0.20;
  return {
    needs: Math.round(needs),
    wants: Math.round(wants),
    savings: Math.round(savings),
  };
}