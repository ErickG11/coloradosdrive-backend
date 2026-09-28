// Validación de cédula ecuatoriana: 10 dígitos, provincia 01-24 (o 30 para
// ecuatorianos registrados en el exterior), tercer dígito < 6 (persona
// natural) y dígito verificador por módulo 10 con coeficientes 2,1,2,1...
export function isValidCedulaEcuatoriana(cedula: string): boolean {
  if (!/^[0-9]{10}$/.test(cedula)) {
    return false;
  }

  const province = Number(cedula.slice(0, 2));
  if ((province < 1 || province > 24) && province !== 30) {
    return false;
  }

  if (Number(cedula[2]) >= 6) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const coefficient = i % 2 === 0 ? 2 : 1;
    let product = Number(cedula[i]) * coefficient;
    if (product > 9) {
      product -= 9;
    }
    sum += product;
  }

  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number(cedula[9]);
}
