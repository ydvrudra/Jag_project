# file: truck_solver.py
from ortools.sat.python import cp_model
import json
import sys

def main(input_json):
    data = json.loads(input_json)
    packages = data['packages']
    trucks = data['trucks']

    model = cp_model.CpModel()

    num_pkgs = len(packages)
    num_trucks = len(trucks)

    # Decision variables: package i in truck j
    x = {}
    for i in range(num_pkgs):
        for j in range(num_trucks):
            x[(i,j)] = model.NewBoolVar(f'x_{i}_{j}')

    # Each package assigned to exactly one truck
    for i in range(num_pkgs):
        model.Add(sum(x[(i,j)] for j in range(num_trucks)) == 1)

    # Truck constraints: CBM and weight
    for j in range(num_trucks):
        model.Add(sum(int(packages[i]['cbm']*1000)*x[(i,j)] for i in range(num_pkgs)) <= int(trucks[j]['cbmCapacity']*1000))
        model.Add(sum(packages[i]['weightKg']*x[(i,j)] for i in range(num_pkgs)) <= trucks[j]['maxWeightKg'])

    # Stackable constraints (simple version)
    for i in range(num_pkgs):
        if not packages[i]['stackable']:
            for j in range(num_trucks):
                model.Add(packages[i]['qty'] <= 1 * x[(i,j)])

    # Objective: minimize total number of trucks used
    truck_used = [model.NewBoolVar(f'truck_used_{j}') for j in range(num_trucks)]
    for j in range(num_trucks):
        model.AddMaxEquality(truck_used[j], [x[(i,j)] for i in range(num_pkgs)])
    model.Minimize(sum(truck_used))

    solver = cp_model.CpSolver()
    status = solver.Solve(model)

    result = []
    if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
        for j in range(num_trucks):
            truck_items = []
            for i in range(num_pkgs):
                if solver.Value(x[(i,j)]) == 1:
                    truck_items.append(packages[i])
            if truck_items:
                result.append({
                    'truckId': trucks[j]['truckId'],
                    'truckName': trucks[j]['truckName'],
                    'items': truck_items
                })

    print(json.dumps(result))

if __name__ == '__main__':
    main(sys.argv[1])
